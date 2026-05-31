#!/usr/bin/env ts-node
import { Command } from "commander";
import {
  loadContext,
  findMarket,
  getTokenBalance,
  formatTokenAmount,
  formatTimestamp,
  formatProbability,
  computeProbabilities,
  printTable,
  MARKET_TYPE_BINARY,
  MARKET_TYPE_CONTINUOUS,
  MARKET_TYPE_NAMES,
  MARKET_STATE_NAMES,
  SCALE,
  BN,
} from "./common";

const program_ = new Command();

program_
  .name("resolve")
  .description("DekantPM market resolution and settlement");

// ─── market (binary/multi) ───────────────────────────────────────────────────
program_
  .command("market")
  .description("Resolve a market (signer must be the assigned oracle)")
  .argument("<market-id>", "Market ID (numeric)")
  .argument("[outcome]", "Winning outcome index (0-based) — required for binary/multi, ignored for continuous")
  .option("--value <number>", "Resolved value for continuous markets (human-readable)")
  .action(async (marketIdStr, outcomeStr, opts) => {
    const ctx = loadContext();
    const marketId = parseInt(marketIdStr, 10);
    const [marketPda] = findMarket(marketId, ctx.programId);

    const market = await ctx.program.account.market.fetch(marketPda);

    let outcome: number;
    let value: BN;

    if (market.marketType === MARKET_TYPE_CONTINUOUS) {
      if (!opts.value) {
        console.error("Error: --value <number> is required for continuous market resolution");
        process.exit(1);
      }
      // Continuous resolution: value determines the winning bin
      value = new BN(opts.value).mul(SCALE);
      outcome = outcomeStr != null ? parseInt(outcomeStr, 10) : 0;
      console.log(`Resolving continuous market #${marketId} with value ${opts.value}...`);
    } else {
      // Binary/multi resolution: outcome is the winning index
      if (outcomeStr == null) {
        console.error("Error: <outcome> index is required for binary/multi market resolution");
        process.exit(1);
      }
      outcome = parseInt(outcomeStr, 10);
      value = new BN(0);
      const label = market.marketType === MARKET_TYPE_BINARY
        ? (outcome === 0 ? "Yes" : "No")
        : `Outcome ${outcome}`;
      console.log(`Resolving market #${marketId} with winner: ${label}...`);
    }

    const tx = await ctx.program.methods
      .resolveMarket({ outcome, value })
      .accountsPartial({
        oracle: ctx.keypair.publicKey,
        market: marketPda,
      })
      .rpc();

    console.log(`  Market resolved! Tx: ${tx}`);

    // Show post-resolution state
    const resolved = await ctx.program.account.market.fetch(marketPda);
    const isContinuous = market.marketType === MARKET_TYPE_CONTINUOUS;
    printTable([
      ["State", MARKET_STATE_NAMES[resolved.state]],
      ["Resolved outcome", resolved.resolvedOutcome.toString()],
      ["Resolved at", formatTimestamp(resolved.resolvedAt.toNumber())],
      ...(isContinuous
        ? [
            ["Resolved value", (Number(resolved.resolvedValue.toString()) / Number(SCALE.toString())).toString()],
            ["Kernel width", resolved.kernelWidth.toString()],
            ["Scaling factor", resolved.scalingFactor.toString()],
          ] as [string, string][]
        : []),
    ]);
  });

// ─── info ────────────────────────────────────────────────────────────────────
program_
  .command("info")
  .description("Show resolution details for a market")
  .argument("<market-id>", "Market ID (numeric)")
  .action(async (marketIdStr) => {
    const ctx = loadContext();
    const marketId = parseInt(marketIdStr, 10);
    const [marketPda] = findMarket(marketId, ctx.programId);

    const market = await ctx.program.account.market.fetch(marketPda);
    const vaultBalance = await getTokenBalance(ctx.connection, market.vault);

    console.log(`\nMarket #${marketId} Resolution Info:`);
    printTable([
      ["Type", MARKET_TYPE_NAMES[market.marketType]],
      ["State", MARKET_STATE_NAMES[market.state]],
      ["Oracle", market.oracle.toBase58()],
      ["Deadline", formatTimestamp(market.deadline.toNumber())],
      ["Vault balance", formatTokenAmount(vaultBalance)],
    ]);

    if (market.state === 3) { // Resolved
      printTable([
        ["Resolved outcome", market.resolvedOutcome.toString()],
        ["Resolved at", formatTimestamp(market.resolvedAt.toNumber())],
      ]);

      if (market.marketType === MARKET_TYPE_CONTINUOUS) {
        const resolvedVal = Number(market.resolvedValue.toString()) / Number(SCALE.toString());
        const rangeMin = Number(market.rangeMin.toString()) / Number(SCALE.toString());
        const rangeMax = Number(market.rangeMax.toString()) / Number(SCALE.toString());
        printTable([
          ["Resolved value", resolvedVal.toString()],
          ["Range", `[${rangeMin}, ${rangeMax}]`],
          ["Winning bin", market.resolvedOutcome.toString()],
        ]);
      } else {
        const label = market.marketType === MARKET_TYPE_BINARY
          ? (market.resolvedOutcome === 0 ? "Yes" : "No")
          : `Outcome ${market.resolvedOutcome}`;
        console.log(`  Winner: ${label}`);
      }
    } else if (market.state === 2) { // PendingResolution
      console.log("\n  Market is pending resolution (deadline passed, awaiting oracle).");
    } else {
      console.log(`\n  Market is ${MARKET_STATE_NAMES[market.state]} (not yet eligible for resolution).`);
    }

    // Show probabilities
    const probs = computeProbabilities(market.reserves, market.totalMinted);
    console.log("\n  Final probabilities:");
    for (let i = 0; i < Math.min(probs.length, 32); i++) {
      if (probs[i] > 0.001 || probs.length <= 10) {
        const label = market.marketType === MARKET_TYPE_BINARY
          ? (i === 0 ? "Yes" : "No")
          : market.marketType === MARKET_TYPE_CONTINUOUS
            ? `Bin ${i}`
            : `Outcome ${i}`;
        const marker = market.state === 3 && i === market.resolvedOutcome ? " <-- WINNER" : "";
        console.log(`    ${label.padEnd(12)} ${formatProbability(probs[i]).padStart(8)}${marker}`);
      }
    }
    if (probs.length > 32) {
      console.log(`    ... (${probs.length - 32} more bins)`);
    }
  });

program_.parse(process.argv);
