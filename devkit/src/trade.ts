#!/usr/bin/env ts-node
import { Command } from "commander";
import { ComputeBudgetProgram } from "@solana/web3.js";
import {
  loadContext,
  findProtocolConfig,
  findMarket,
  findVaultAuthority,
  findUserPosition,
  findLpPosition,
  getOrCreateAta,
  mintTokens,
  getTokenBalance,
  parseTokenAmount,
  formatTokenAmount,
  formatProbability,
  computeProbabilities,
  printTable,
  outcomeLabel,
  MARKET_TYPE_CONTINUOUS,
  MARKET_TYPE_NAMES,
  SCALE,
  BN,
  PublicKey,
  SystemProgram,
  TOKEN_PROGRAM_ID,
} from "./common";

const program_ = new Command();

program_
  .name("trade")
  .description("DekantPM trading commands");

// ─── Shared: fetch market + derive accounts ──────────────────────────────────
async function loadTradeContext(marketIdStr: string) {
  const ctx = loadContext();
  const marketId = parseInt(marketIdStr, 10);
  const [protocolConfig] = findProtocolConfig(ctx.programId);
  const [marketPda] = findMarket(marketId, ctx.programId);
  const [vaultAuthority] = findVaultAuthority(marketPda, ctx.programId);
  const [userPosition] = findUserPosition(marketPda, ctx.keypair.publicKey, ctx.programId);

  const market = await ctx.program.account.market.fetch(marketPda);
  const traderAta = await getOrCreateAta(
    ctx.connection,
    market.collateralMint,
    ctx.keypair.publicKey,
    ctx.keypair
  );

  return {
    ...ctx,
    marketId,
    marketPda,
    protocolConfig,
    vaultAuthority,
    userPosition,
    market,
    traderAta,
  };
}

function printBeforeAfter(label: string, market: any, newMarket: any) {
  const probsBefore = computeProbabilities(market.reserves, market.totalMinted);
  const probsAfter = computeProbabilities(newMarket.reserves, newMarket.totalMinted);
  const maxDisplay = probsBefore.length <= 10 ? probsBefore.length : 32;

  console.log(`\n  ${label} probabilities:`);
  for (let i = 0; i < Math.min(probsBefore.length, maxDisplay); i++) {
    // For large markets, skip bins with negligible change
    if (probsBefore.length > 10 && Math.abs(probsAfter[i] - probsBefore[i]) < 0.0001 && probsBefore[i] < 0.001) continue;
    const tag = outcomeLabel(market.marketType, i);
    console.log(
      `    ${tag.padEnd(12)} ${formatProbability(probsBefore[i]).padStart(8)} -> ${formatProbability(probsAfter[i]).padStart(8)}`
    );
  }
  if (probsBefore.length > maxDisplay) {
    console.log(`    ... (${probsBefore.length - maxDisplay} more bins)`);
  }
}

// ─── buy ─────────────────────────────────────────────────────────────────────
program_
  .command("buy")
  .description("Buy outcome tokens (discrete: binary/multi)")
  .argument("<market-id>", "Market ID")
  .argument("<outcome>", "Outcome index (0-based)")
  .argument("<amount>", "Collateral amount (human-readable, e.g. 10)")
  .action(async (marketIdStr, outcomeStr, amountStr) => {
    const tc = await loadTradeContext(marketIdStr);
    const outcome = parseInt(outcomeStr, 10);
    const collateralAmount = parseTokenAmount(amountStr);

    console.log(`Buying outcome ${outcome} on market #${tc.marketId} for ${amountStr} tokens...`);

    const balanceBefore = await getTokenBalance(tc.connection, tc.traderAta);

    const tx = await tc.program.methods
      .buy({ outcome, collateralAmount })
      .accountsPartial({
        trader: tc.keypair.publicKey,
        market: tc.marketPda,
        protocolConfig: tc.protocolConfig,
        userPosition: tc.userPosition,
        vaultAuthority: tc.vaultAuthority,
        vault: tc.market.vault,
        traderAta: tc.traderAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const balanceAfter = await getTokenBalance(tc.connection, tc.traderAta);
    const newMarket = await tc.program.account.market.fetch(tc.marketPda);

    console.log(`  Tx: ${tx}`);
    console.log(`  Collateral spent: ${formatTokenAmount(balanceBefore - balanceAfter)}`);
    printBeforeAfter("Buy", tc.market, newMarket);
  });

// ─── sell ────────────────────────────────────────────────────────────────────
program_
  .command("sell")
  .description("Sell outcome tokens (discrete: binary/multi)")
  .argument("<market-id>", "Market ID")
  .argument("<outcome>", "Outcome index (0-based)")
  .argument("<amount>", "Token amount to sell (human-readable)")
  .action(async (marketIdStr, outcomeStr, amountStr) => {
    const tc = await loadTradeContext(marketIdStr);
    const outcome = parseInt(outcomeStr, 10);
    const tokenAmount = parseTokenAmount(amountStr);

    console.log(`Selling ${amountStr} tokens of outcome ${outcome} on market #${tc.marketId}...`);

    const balanceBefore = await getTokenBalance(tc.connection, tc.traderAta);

    const tx = await tc.program.methods
      .sell({ outcome, tokenAmount })
      .accountsPartial({
        trader: tc.keypair.publicKey,
        market: tc.marketPda,
        protocolConfig: tc.protocolConfig,
        userPosition: tc.userPosition,
        vaultAuthority: tc.vaultAuthority,
        vault: tc.market.vault,
        traderAta: tc.traderAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const balanceAfter = await getTokenBalance(tc.connection, tc.traderAta);
    const newMarket = await tc.program.account.market.fetch(tc.marketPda);

    console.log(`  Tx: ${tx}`);
    console.log(`  Collateral received: ${formatTokenAmount(balanceAfter - balanceBefore)}`);
    printBeforeAfter("Sell", tc.market, newMarket);
  });

// ─── buy-dist ────────────────────────────────────────────────────────────────
program_
  .command("buy-dist")
  .description("Buy a distribution position (continuous markets)")
  .argument("<market-id>", "Market ID")
  .argument("<mu>", "Distribution center (human-readable, e.g. 180)")
  .argument("<sigma>", "Distribution width/std-dev (human-readable, e.g. 30)")
  .argument("<amount>", "Collateral amount (human-readable)")
  .action(async (marketIdStr, muStr, sigmaStr, amountStr) => {
    const tc = await loadTradeContext(marketIdStr);
    const mu = new BN(muStr).mul(SCALE);
    const sigma = new BN(sigmaStr).mul(SCALE);
    const collateralAmount = parseTokenAmount(amountStr);

    console.log(`Buying distribution N(${muStr}, ${sigmaStr}) on market #${tc.marketId} for ${amountStr} tokens...`);

    const balanceBefore = await getTokenBalance(tc.connection, tc.traderAta);

    const tx = await tc.program.methods
      .buyDistribution({ mu, sigma, collateralAmount })
      .accountsPartial({
        trader: tc.keypair.publicKey,
        market: tc.marketPda,
        protocolConfig: tc.protocolConfig,
        userPosition: tc.userPosition,
        vaultAuthority: tc.vaultAuthority,
        vault: tc.market.vault,
        traderAta: tc.traderAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      ])
      .rpc();

    const balanceAfter = await getTokenBalance(tc.connection, tc.traderAta);
    const newMarket = await tc.program.account.market.fetch(tc.marketPda);

    console.log(`  Tx: ${tx}`);
    console.log(`  Collateral spent: ${formatTokenAmount(balanceBefore - balanceAfter)}`);
    printBeforeAfter("BuyDist", tc.market, newMarket);
  });

// ─── sell-dist ───────────────────────────────────────────────────────────────
program_
  .command("sell-dist")
  .description("Sell a distribution position (continuous markets)")
  .argument("<market-id>", "Market ID")
  .argument("<mu>", "Distribution center (human-readable)")
  .argument("<sigma>", "Distribution width/std-dev (human-readable)")
  .argument("<amount>", "Token amount to sell (human-readable)")
  .action(async (marketIdStr, muStr, sigmaStr, amountStr) => {
    const tc = await loadTradeContext(marketIdStr);
    const mu = new BN(muStr).mul(SCALE);
    const sigma = new BN(sigmaStr).mul(SCALE);
    const tokenAmount = parseTokenAmount(amountStr);

    console.log(`Selling distribution N(${muStr}, ${sigmaStr}) on market #${tc.marketId}, ${amountStr} tokens...`);

    const balanceBefore = await getTokenBalance(tc.connection, tc.traderAta);

    const tx = await tc.program.methods
      .sellDistribution({ mu, sigma, tokenAmount })
      .accountsPartial({
        trader: tc.keypair.publicKey,
        market: tc.marketPda,
        protocolConfig: tc.protocolConfig,
        userPosition: tc.userPosition,
        vaultAuthority: tc.vaultAuthority,
        vault: tc.market.vault,
        traderAta: tc.traderAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
      ])
      .rpc();

    const balanceAfter = await getTokenBalance(tc.connection, tc.traderAta);
    const newMarket = await tc.program.account.market.fetch(tc.marketPda);

    console.log(`  Tx: ${tx}`);
    console.log(`  Collateral received: ${formatTokenAmount(balanceAfter - balanceBefore)}`);
    printBeforeAfter("SellDist", tc.market, newMarket);
  });

// ─── buy-to-price ────────────────────────────────────────────────────────────
program_
  .command("buy-to-price")
  .description("Buy outcome tokens up to a target probability")
  .argument("<market-id>", "Market ID")
  .argument("<outcome>", "Outcome index (0-based)")
  .argument("<target-prob>", "Target probability (0-100, e.g. 70 for 70%)")
  .option("--max-collateral <amount>", "Max collateral willing to spend (default: 1000)", "1000")
  .action(async (marketIdStr, outcomeStr, targetProbStr, opts) => {
    const tc = await loadTradeContext(marketIdStr);
    const outcome = parseInt(outcomeStr, 10);
    const targetProbPct = parseFloat(targetProbStr);
    const targetProbability = new BN(Math.floor(targetProbPct * Number(SCALE.toString()) / 100));
    const maxCollateral = parseTokenAmount(opts.maxCollateral);

    console.log(`Buying outcome ${outcome} to ${targetProbPct}% on market #${tc.marketId}...`);

    const balanceBefore = await getTokenBalance(tc.connection, tc.traderAta);

    const tx = await tc.program.methods
      .buyToPrice({ outcome, targetProbability, maxCollateral })
      .accountsPartial({
        trader: tc.keypair.publicKey,
        market: tc.marketPda,
        protocolConfig: tc.protocolConfig,
        userPosition: tc.userPosition,
        vaultAuthority: tc.vaultAuthority,
        vault: tc.market.vault,
        traderAta: tc.traderAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const balanceAfter = await getTokenBalance(tc.connection, tc.traderAta);
    const newMarket = await tc.program.account.market.fetch(tc.marketPda);

    console.log(`  Tx: ${tx}`);
    console.log(`  Collateral spent: ${formatTokenAmount(balanceBefore - balanceAfter)}`);
    printBeforeAfter("BuyToPrice", tc.market, newMarket);
  });

// ─── sell-to-price ───────────────────────────────────────────────────────────
program_
  .command("sell-to-price")
  .description("Sell outcome tokens down to a target probability")
  .argument("<market-id>", "Market ID")
  .argument("<outcome>", "Outcome index (0-based)")
  .argument("<target-prob>", "Target probability (0-100, e.g. 30 for 30%)")
  .option("--min-collateral <amount>", "Min collateral willing to receive (default: 0)", "0")
  .action(async (marketIdStr, outcomeStr, targetProbStr, opts) => {
    const tc = await loadTradeContext(marketIdStr);
    const outcome = parseInt(outcomeStr, 10);
    const targetProbPct = parseFloat(targetProbStr);
    const targetProbability = new BN(Math.floor(targetProbPct * Number(SCALE.toString()) / 100));
    const minCollateralOut = parseTokenAmount(opts.minCollateral);

    console.log(`Selling outcome ${outcome} to ${targetProbPct}% on market #${tc.marketId}...`);

    const balanceBefore = await getTokenBalance(tc.connection, tc.traderAta);

    const tx = await tc.program.methods
      .sellToPrice({ outcome, targetProbability, minCollateralOut })
      .accountsPartial({
        trader: tc.keypair.publicKey,
        market: tc.marketPda,
        protocolConfig: tc.protocolConfig,
        userPosition: tc.userPosition,
        vaultAuthority: tc.vaultAuthority,
        vault: tc.market.vault,
        traderAta: tc.traderAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const balanceAfter = await getTokenBalance(tc.connection, tc.traderAta);
    const newMarket = await tc.program.account.market.fetch(tc.marketPda);

    console.log(`  Tx: ${tx}`);
    console.log(`  Collateral received: ${formatTokenAmount(balanceAfter - balanceBefore)}`);
    printBeforeAfter("SellToPrice", tc.market, newMarket);
  });

// ─── add-lp ──────────────────────────────────────────────────────────────────
program_
  .command("add-lp")
  .description("Add liquidity to a market")
  .argument("<market-id>", "Market ID")
  .argument("<amount>", "Collateral amount (human-readable)")
  .action(async (marketIdStr, amountStr) => {
    const ctx = loadContext();
    const marketId = parseInt(marketIdStr, 10);
    const [marketPda] = findMarket(marketId, ctx.programId);
    const [vaultAuthority] = findVaultAuthority(marketPda, ctx.programId);
    const [lpPosition] = findLpPosition(marketPda, ctx.keypair.publicKey, ctx.programId);

    const market = await ctx.program.account.market.fetch(marketPda);
    const providerAta = await getOrCreateAta(
      ctx.connection,
      market.collateralMint,
      ctx.keypair.publicKey,
      ctx.keypair
    );

    const amount = parseTokenAmount(amountStr);
    console.log(`Adding ${amountStr} liquidity to market #${marketId}...`);

    const tx = await ctx.program.methods
      .addLiquidity({ amount })
      .accountsPartial({
        provider: ctx.keypair.publicKey,
        market: marketPda,
        lpPosition,
        vaultAuthority,
        vault: market.vault,
        providerAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`  Liquidity added! Tx: ${tx}`);

    try {
      const lp = await ctx.program.account.lpPosition.fetch(lpPosition);
      printTable([
        ["LP shares", lp.shares.toString()],
        ["Deposited", formatTokenAmount(lp.depositedCollateral)],
      ]);
    } catch {}
  });

// ─── remove-lp ───────────────────────────────────────────────────────────────
program_
  .command("remove-lp")
  .description("Remove liquidity from a market")
  .argument("<market-id>", "Market ID")
  .argument("<shares>", 'LP shares to burn (or "all")')
  .action(async (marketIdStr, sharesStr) => {
    const ctx = loadContext();
    const marketId = parseInt(marketIdStr, 10);
    const [marketPda] = findMarket(marketId, ctx.programId);
    const [vaultAuthority] = findVaultAuthority(marketPda, ctx.programId);
    const [lpPosition] = findLpPosition(marketPda, ctx.keypair.publicKey, ctx.programId);

    const market = await ctx.program.account.market.fetch(marketPda);
    const providerAta = await getOrCreateAta(
      ctx.connection,
      market.collateralMint,
      ctx.keypair.publicKey,
      ctx.keypair
    );

    const lp = await ctx.program.account.lpPosition.fetch(lpPosition);
    const sharesToBurn = sharesStr === "all"
      ? lp.shares
      : new BN(sharesStr);

    console.log(`Removing ${sharesStr === "all" ? "all" : sharesToBurn.toString()} LP shares from market #${marketId}...`);

    const balanceBefore = await getTokenBalance(ctx.connection, providerAta);

    const tx = await ctx.program.methods
      .removeLiquidity({ sharesToBurn })
      .accountsPartial({
        provider: ctx.keypair.publicKey,
        market: marketPda,
        lpPosition,
        vaultAuthority,
        vault: market.vault,
        providerAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const balanceAfter = await getTokenBalance(ctx.connection, providerAta);

    console.log(`  Liquidity removed! Tx: ${tx}`);
    console.log(`  Collateral returned: ${formatTokenAmount(balanceAfter - balanceBefore)}`);
  });

// ─── position ────────────────────────────────────────────────────────────────
program_
  .command("position")
  .description("View a user's position in a market")
  .argument("<market-id>", "Market ID")
  .option("--wallet <address>", "Wallet to query (default: signer)")
  .action(async (marketIdStr, opts) => {
    const ctx = loadContext();
    const marketId = parseInt(marketIdStr, 10);
    const wallet = opts.wallet ? new PublicKey(opts.wallet) : ctx.keypair.publicKey;
    const [marketPda] = findMarket(marketId, ctx.programId);
    const [userPosition] = findUserPosition(marketPda, wallet, ctx.programId);

    try {
      const position = await ctx.program.account.userPosition.fetch(userPosition);
      const market = await ctx.program.account.market.fetch(marketPda);

      console.log(`\nPosition in market #${marketId}:`);
      printTable([
        ["Market", marketPda.toBase58()],
        ["User", position.user.toBase58()],
        ["Total deposited", formatTokenAmount(position.totalDeposited)],
        ["Total withdrawn", formatTokenAmount(position.totalWithdrawn)],
        ["Claimed", position.claimed ? "Yes" : "No"],
      ]);

      console.log("\n  Holdings:");
      let hasHoldings = false;
      for (let i = 0; i < position.holdings.length; i++) {
        const h = position.holdings[i];
        if (h.toNumber() > 0) {
          hasHoldings = true;
          const label = outcomeLabel(market.marketType, i);
          console.log(`    ${label.padEnd(12)} ${h.toString()}`);
        }
      }
      if (!hasHoldings) {
        console.log("    (no holdings)");
      }
    } catch (e: any) {
      console.log(`  No position found for wallet ${wallet.toBase58()} in market #${marketId}`);
    }
  });

// ─── fund ────────────────────────────────────────────────────────────────────
program_
  .command("fund")
  .description("Mint collateral tokens to a wallet (localnet only)")
  .argument("<market-id>", "Market ID (to get the collateral mint)")
  .argument("<amount>", "Amount to mint (human-readable)")
  .option("--wallet <address>", "Target wallet to fund (default: signer)")
  .action(async (marketIdStr, amountStr, opts) => {
    const ctx = loadContext();
    const marketId = parseInt(marketIdStr, 10);
    const [marketPda] = findMarket(marketId, ctx.programId);

    const target = opts.wallet ? new PublicKey(opts.wallet) : ctx.keypair.publicKey;
    const market = await ctx.program.account.market.fetch(marketPda);
    const ata = await getOrCreateAta(
      ctx.connection,
      market.collateralMint,
      target,
      ctx.keypair
    );

    const amount = parseTokenAmount(amountStr);
    await mintTokens(ctx.connection, market.collateralMint, ata, ctx.keypair, BigInt(amount.toString()));

    const balance = await getTokenBalance(ctx.connection, ata);
    console.log(`  Minted ${amountStr} tokens to ${target.toBase58()}`);
    console.log(`  New balance: ${formatTokenAmount(balance)}`);
  });

program_.parse(process.argv);
