#!/usr/bin/env ts-node
/**
 * Verify a claim payout matches the on-chain formula bit-for-bit.
 *
 * Mirrors `claim_payout` in programs/dekant-pm/src/instructions/trading/claim_payout.rs
 * using BigInt:
 *
 *   gross = kernel_branch ? compute_kernel_payout(...) : holdings[winningOutcome]
 *   fee   = floor( gross * redemption_fee_bps / 10_000 )
 *   net   = gross - fee
 *
 * Routes through the kernel branch only when `marketType === Continuous && kernelWidth > 0`;
 * otherwise applies the WTA formula (binary, multi, legacy continuous with width=0).
 *
 * Usage:
 *   ts-node verify-claim.ts <market-id> <wallet-pubkey> <actual-net-raw> [--tolerance N]
 *
 * Exits 0 on match (within tolerance, default 1 base unit), exits 1 on mismatch
 * or if the market is not resolved.
 */
import { Command } from "commander";
import {
  loadContext,
  findMarket,
  findUserPosition,
  findProtocolConfig,
  MARKET_TYPE_CONTINUOUS,
  MARKET_STATE_RESOLVED,
  SCALE,
  PublicKey,
} from "./common";

// ─── BigInt kernel mirror (matches engine/kernel.rs floor semantics) ────────

const SCALE_BIG = BigInt(SCALE.toString());
const ZERO = BigInt(0);
const ONE = BigInt(1);
const BPS_DENOM = BigInt(10_000);

function kernelWeight(i: number, win: number, w: number): bigint {
  const d = BigInt(Math.abs(i - win));
  const wBig = BigInt(w);
  if (d > wBig) return ZERO;
  const denom = wBig + ONE;
  return (SCALE_BIG * (denom - d)) / denom;
}

function computeKernelGross(
  holdings: bigint[],
  winBin: number,
  kernelWidth: number,
  scalingFactor: bigint,
): bigint {
  let raw = ZERO;
  for (let i = 0; i < holdings.length; i++) {
    const h = holdings[i];
    if (h === ZERO) continue;
    const weight = kernelWeight(i, winBin, kernelWidth);
    if (weight === ZERO) continue;
    raw += (h * weight) / SCALE_BIG;
  }
  return (raw * scalingFactor) / SCALE_BIG;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const program_ = new Command();

program_
  .name("verify-claim")
  .description(
    "Verify an observed net-claim amount matches the on-chain kernel formula",
  )
  .argument("<market-id>", "Market ID (numeric)")
  .argument("<wallet-pubkey>", "Wallet that claimed (base58)")
  .argument(
    "<actual-net-raw>",
    "Observed net payout in raw base units (balance delta)",
  )
  .option(
    "--tolerance <n>",
    "Allowed absolute mismatch in raw base units (default 1)",
    "1",
  )
  .action(async (marketIdStr, walletStr, actualStr, opts) => {
    const ctx = loadContext();
    const marketId = parseInt(marketIdStr, 10);
    const wallet = new PublicKey(walletStr);
    const actualNet = BigInt(actualStr);
    const tolerance = BigInt(opts.tolerance);

    const [marketPda] = findMarket(marketId, ctx.programId);
    const [userPosition] = findUserPosition(marketPda, wallet, ctx.programId);
    const [protocolConfig] = findProtocolConfig(ctx.programId);

    const market = await ctx.program.account.market.fetch(marketPda);
    const position = await ctx.program.account.userPosition.fetch(userPosition);
    const config = await ctx.program.account.protocolConfig.fetch(protocolConfig);

    if (market.state !== MARKET_STATE_RESOLVED) {
      console.error(
        `verify-claim: market #${marketId} is not resolved (state=${market.state})`,
      );
      process.exit(1);
    }

    const win = market.resolvedOutcome as number;
    const holdings: bigint[] = position.holdings.map((h: any) =>
      BigInt(h.toString()),
    );
    const kernelMode =
      market.marketType === MARKET_TYPE_CONTINUOUS && market.kernelWidth > 0;

    let expectedGross: bigint;
    if (kernelMode) {
      const sf = BigInt(market.scalingFactor.toString());
      expectedGross = computeKernelGross(holdings, win, market.kernelWidth, sf);
    } else {
      expectedGross = holdings[win] ?? ZERO;
    }

    const feeBps = BigInt(config.redemptionFeeBps);
    const fee = (expectedGross * feeBps) / BPS_DENOM;
    const expectedNet = expectedGross - fee;

    const diff =
      expectedNet > actualNet ? expectedNet - actualNet : actualNet - expectedNet;
    const ok = diff <= tolerance;

    const summary =
      `market=#${marketId} mode=${kernelMode ? "kernel" : "WTA"} ` +
      `winBin=${win} kw=${market.kernelWidth} ` +
      `sf=${market.scalingFactor.toString()} ` +
      `feeBps=${feeBps.toString()} | ` +
      `expected_gross=${expectedGross.toString()} ` +
      `fee=${fee.toString()} expected_net=${expectedNet.toString()} ` +
      `actual_net=${actualNet.toString()} diff=${diff.toString()}`;

    if (ok) {
      console.log(`✓ verify-claim ${summary}`);
      process.exit(0);
    } else {
      console.error(`✗ verify-claim MISMATCH ${summary} tol=${tolerance.toString()}`);
      process.exit(1);
    }
  });

program_.parseAsync(process.argv);
