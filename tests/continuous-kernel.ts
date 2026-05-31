/**
 * P5-2: Integration tests for the smooth kernel resolution path on continuous
 * markets. Pairs with the Rust unit suite in
 * `programs/dekant-pm/tests/unit/state_market.rs` (P5-1) — those test the
 * resolve-side math in isolation; this file drives the on-chain `claim_payout`
 * instruction end-to-end against a live anchor program.
 *
 * Scenario inventory (per planning §P5-2):
 *   K1  randomized width      — basic kernel claim
 *   K2  pinned width = 4      — scaling factor < SCALE triggers
 *   K3  pinned width = 1      — no-scaling path (sf == SCALE)
 *   K4  randomized width      — trader outside kernel range → NothingToClaim
 *   K5  randomized width      — boundary resolution (winner at bin 0)
 *   K6  randomized width      — boundary resolution (winner at last bin)
 *   K7  randomized width      — LP removal order independence
 *   K8  pinned width = 0      — WTA mode regression for migrated markets
 *   K9  pinned width = N-1    — maximum legal kernel width
 *
 * Width selection: `makeWidthPicker()` (no-repeat closure) guarantees every
 * randomized `it(...)` draws a distinct value from `[1..10]`. Pinned scenarios
 * pre-reserve their value upfront so the picker never collides with them.
 *
 * Redemption fee: forced to 0 for every market in this file (saved & restored
 * around the suite) so expected-payout formulas have no `- fee` term to
 * compute. Redemption-fee mechanics are covered separately in
 * `tests/resolution-1to1.ts`.
 */

import { BN } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import { ctx } from "./helpers/context";
import { ensureSetup } from "./helpers/setup";
import { findUserPosition, findLpPosition } from "./helpers/pda";
import { airdropSol, getOrCreateAta, mintTokens } from "./helpers/accounts";
import { createContinuousMarket } from "./helpers/market-helper";
import { SCALE } from "./helpers/constants";

// ── Constants ────────────────────────────────────────────────────────

const SCALE_BIG = BigInt(SCALE.toString());

// ── Width picker (closure) ──────────────────────────────────────────
//
// Two sets: `reserved` (permanent, set via `pickWidth.reserve(w)`) and
// `drawn` (this cycle's random draws). Within a cycle, every randomized
// scenario gets a distinct width. When the candidate pool empties, `drawn`
// is cleared (reservations survive) and picking continues — so repeats are
// possible across cycles, never within one. Bumping the `max` argument
// (default 10) is still the right move if you want more distinct widths
// before the first reset, but the picker no longer crashes when you don't.

type WidthPicker = {
  (numBins: number, min?: number, max?: number): number;
  reserve: (w: number) => void;
};

function makeWidthPicker(): WidthPicker {
  const reserved = new Set<number>();
  const drawn = new Set<number>();
  const candidates = (lo: number, hi: number): number[] => {
    const free: number[] = [];
    for (let w = lo; w <= hi; w++) {
      if (!reserved.has(w) && !drawn.has(w)) free.push(w);
    }
    return free;
  };
  const pick = ((numBins: number, min: number = 1, max: number = 10): number => {
    const hi = Math.min(max, numBins - 1);
    const lo = Math.max(min, 1);
    let free = candidates(lo, hi);
    if (free.length === 0) {
      console.log(
        `[pickWidth] pool [${lo}..${hi}] exhausted; resetting drawn set (reservations kept: ${[...reserved].join(",") || "none"})`
      );
      drawn.clear();
      free = candidates(lo, hi);
      if (free.length === 0) {
        // Reservations alone cover the range — configuration bug, not exhaustion.
        throw new Error(
          `pickWidth: range [${lo}..${hi}] is fully reserved (${[...reserved].join(",")}); no random draws possible`
        );
      }
    }
    const w = free[Math.floor(Math.random() * free.length)];
    drawn.add(w);
    return w;
  }) as WidthPicker;
  pick.reserve = (w: number) => { reserved.add(w); };
  return pick;
}

const pickWidth = makeWidthPicker();
// Pre-reserve every pinned value so randomized scenarios can't redraw them.
// K9 reserves `numBins - 1` inside its scenario (depends on the market's
// numBins, so it can't be reserved at file scope).
pickWidth.reserve(0);   // K8 — WTA / migrated-market regression
pickWidth.reserve(1);   // K3 — no-scaling path
pickWidth.reserve(4);   // K2 — calculated to trigger scaling

// ── Kernel math (mirrors `programs/dekant-pm/src/engine/kernel.rs`) ──
//
// BigInt throughout — the on-chain math is u128 with SCALE = 10^9; a JS
// `number` loses precision past 2^53 and would silently drift from the
// on-chain result on large fixtures.

const ZERO = BigInt(0);
const ONE = BigInt(1);

function kernelWeight(i: number, win: number, w: number): bigint {
  const d = BigInt(Math.abs(i - win));
  const wBig = BigInt(w);
  if (d > wBig) return ZERO;
  const denom = wBig + ONE;
  return (SCALE_BIG * (denom - d)) / denom;
}

/** Σ_i (tokens[i] * K(i, win, w) / SCALE) — mirrors `raw_claims()` in Rust. */
function rawClaims(tokens: bigint[], win: number, w: number): bigint {
  let total = ZERO;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === ZERO) continue;
    const weight = kernelWeight(i, win, w);
    if (weight === ZERO) continue;
    total += (tokens[i] * weight) / SCALE_BIG;
  }
  return total;
}

/** Mirrors `compute_kernel_payout` in Rust — same flooring order. */
function computeKernelPayout(
  holdings: bigint[],
  win: number,
  w: number,
  scalingFactor: bigint,
): bigint {
  const raw = rawClaims(holdings, win, w);
  return (raw * scalingFactor) / SCALE_BIG;
}

// ── On-chain helpers ────────────────────────────────────────────────

async function getVaultBalance(vault: PublicKey): Promise<bigint> {
  return (await getAccount(ctx.provider.connection, vault)).amount;
}

async function fundTrader(
  trader: Keypair,
  amount: bigint = BigInt(200_000_000),
): Promise<PublicKey> {
  // Fresh Keypair has 0 SOL — airdrop first so it can fund ATA rent and pay
  // transaction signatures throughout the scenario.
  await airdropSol(trader.publicKey);
  const ata = await getOrCreateAta(ctx.collateralMint, trader.publicKey, trader);
  await mintTokens(ctx.collateralMint, ata, (ctx.superadmin as any).payer, amount);
  return ata;
}

async function buyDistribution(
  trader: Keypair,
  traderAta: PublicKey,
  marketPda: PublicKey,
  vaultAuthority: PublicKey,
  vault: PublicKey,
  mu: BN,
  sigma: BN,
  amount: BN,
) {
  const [userPositionPda] = findUserPosition(marketPda, trader.publicKey, ctx.program.programId);
  await ctx.program.methods
    .buyDistribution({ mu, sigma, collateralAmount: amount })
    .accountsPartial({
      trader: trader.publicKey,
      market: marketPda,
      protocolConfig: ctx.protocolConfig,
      userPosition: userPositionPda,
      vaultAuthority,
      vault,
      traderAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 })])
    .signers([trader])
    .rpc();
}

async function resolveMarket(marketPda: PublicKey, value: BN) {
  await ctx.program.methods
    .resolveMarket({ outcome: 0, value })
    .accountsPartial({ oracle: ctx.oracleKp.publicKey, market: marketPda })
    .signers([ctx.oracleKp])
    .rpc();
}

async function claimPayout(
  trader: Keypair,
  traderAta: PublicKey,
  marketPda: PublicKey,
  vaultAuthority: PublicKey,
  vault: PublicKey,
): Promise<bigint> {
  const [userPositionPda] = findUserPosition(marketPda, trader.publicKey, ctx.program.programId);
  const before = await getAccount(ctx.provider.connection, traderAta);
  await ctx.program.methods
    .claimPayout()
    .accountsPartial({
      trader: trader.publicKey,
      market: marketPda,
      protocolConfig: ctx.protocolConfig,
      userPosition: userPositionPda,
      vaultAuthority,
      vault,
      traderAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([trader])
    .rpc();
  const after = await getAccount(ctx.provider.connection, traderAta);
  return after.amount - before.amount;
}

async function addLiquidity(
  provider: Keypair,
  providerAta: PublicKey,
  marketPda: PublicKey,
  vaultAuthority: PublicKey,
  vault: PublicKey,
  amount: BN,
) {
  const [lpPositionPda] = findLpPosition(marketPda, provider.publicKey, ctx.program.programId);
  await ctx.program.methods
    .addLiquidity({ amount })
    .accountsPartial({
      provider: provider.publicKey,
      market: marketPda,
      lpPosition: lpPositionPda,
      vaultAuthority,
      vault,
      providerAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([provider])
    .rpc();
}

async function removeLiquidity(
  provider: Keypair,
  providerAta: PublicKey,
  marketPda: PublicKey,
  vaultAuthority: PublicKey,
  vault: PublicKey,
  sharesToBurn?: BN,
): Promise<bigint> {
  const [lpPositionPda] = findLpPosition(marketPda, provider.publicKey, ctx.program.programId);
  const lp = await ctx.program.account.lpPosition.fetch(lpPositionPda);
  const shares = sharesToBurn ?? lp.shares;
  const before = await getAccount(ctx.provider.connection, providerAta);
  await ctx.program.methods
    .removeLiquidity({ sharesToBurn: shares })
    .accountsPartial({
      provider: provider.publicKey,
      market: marketPda,
      lpPosition: lpPositionPda,
      vaultAuthority,
      vault,
      providerAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([provider])
    .rpc();
  const after = await getAccount(ctx.provider.connection, providerAta);
  return after.amount - before.amount;
}

async function waitForDeadline(marketPda: PublicKey) {
  const market = await ctx.program.account.market.fetch(marketPda);
  const now = Math.floor(Date.now() / 1000);
  const waitMs = (market.deadline.toNumber() - now + 2) * 1000;
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
}

async function fetchHoldings(
  marketPda: PublicKey,
  trader: PublicKey,
): Promise<bigint[]> {
  const [posPda] = findUserPosition(marketPda, trader, ctx.program.programId);
  const pos = await ctx.program.account.userPosition.fetch(posPda);
  return pos.holdings.map((h: any) => BigInt(h.toString()));
}

/** Compute the value (scaled) that resolves to `bin` (midpoint). */
function valueAtBin(rangeMin: BN, rangeMax: BN, numBins: number, bin: number): BN {
  const span = rangeMax.sub(rangeMin);
  const binWidth = span.div(new BN(numBins));
  return rangeMin.add(binWidth.muln(bin)).add(binWidth.divn(2));
}

// ── Redemption-fee save/restore ────────────────────────────────────

let savedRedemptionFeeBps: number | null = null;
let savedCreationFeeBps: number = 0;
let savedTradeFeeBps: number = 0;
let savedLpFeeShareBps: number = 0;

async function zeroRedemptionFee() {
  const cfg = await ctx.program.account.protocolConfig.fetch(ctx.protocolConfig);
  savedRedemptionFeeBps = cfg.redemptionFeeBps;
  savedCreationFeeBps = cfg.creationFeeBps;
  savedTradeFeeBps = cfg.tradeFeeBps;
  savedLpFeeShareBps = cfg.lpFeeShareBps;
  if (cfg.redemptionFeeBps === 0) return;
  await ctx.program.methods
    .updateFees({
      creationFeeBps: cfg.creationFeeBps,
      tradeFeeBps: cfg.tradeFeeBps,
      redemptionFeeBps: 0,
      lpFeeShareBps: cfg.lpFeeShareBps,
    })
    .accountsPartial({
      authority: ctx.superadmin.publicKey,
      protocolConfig: ctx.protocolConfig,
    })
    .rpc();
}

async function restoreRedemptionFee() {
  if (savedRedemptionFeeBps == null) return;
  await ctx.program.methods
    .updateFees({
      creationFeeBps: savedCreationFeeBps,
      tradeFeeBps: savedTradeFeeBps,
      redemptionFeeBps: savedRedemptionFeeBps,
      lpFeeShareBps: savedLpFeeShareBps,
    })
    .accountsPartial({
      authority: ctx.superadmin.publicKey,
      protocolConfig: ctx.protocolConfig,
    })
    .rpc();
}

// ── Scenarios ───────────────────────────────────────────────────────

describe("P5-2: Smooth-kernel resolution — integration", () => {
  // Set globally for the file: fee=0 lets every scenario assert
  // expected-payout values directly (no `- fee` arithmetic).
  before(async () => {
    await ensureSetup();
    await zeroRedemptionFee();
  });
  after(async () => {
    await restoreRedemptionFee();
  });

  // ── K1 ──────────────────────────────────────────────────────────
  // Basic single-trader claim: trader buys a Gaussian distribution
  // centered on the winning bin; payout must match the kernel formula
  // computed against the on-chain `(kernelWidth, scalingFactor)` pair.
  describe("K1: basic kernel claim", () => {
    const NUM_BINS = 16;
    const RANGE_MIN = new BN(0).mul(SCALE);
    const RANGE_MAX = new BN(300).mul(SCALE);
    const w = pickWidth(NUM_BINS);

    it(`single trader, distribution at winning bin (kernel_width=${w})`, async () => {
      const mkt = await createContinuousMarket({
        numBins: NUM_BINS,
        rangeMin: RANGE_MIN,
        rangeMax: RANGE_MAX,
        deadline: Math.floor(Date.now() / 1000) + 12,
        liquidity: new BN(20_000_000),
        kernelWidth: w,
      });

      const trader = Keypair.generate();
      const traderAta = await fundTrader(trader);

      await buyDistribution(
        trader, traderAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault,
        new BN(150).mul(SCALE), new BN(30).mul(SCALE), new BN(5_000_000),
      );

      const holdingsBefore = await fetchHoldings(mkt.marketPda, trader.publicKey);

      await waitForDeadline(mkt.marketPda);
      await resolveMarket(mkt.marketPda, new BN(155).mul(SCALE));

      const market = await ctx.program.account.market.fetch(mkt.marketPda);
      const win = market.resolvedOutcome;
      const sfOnChain = BigInt(market.scalingFactor.toString());
      const wOnChain = market.kernelWidth;
      expect(wOnChain).to.equal(w, "on-chain kernel_width must match the create-time value");

      const expectedNet = computeKernelPayout(holdingsBefore, win, wOnChain, sfOnChain);
      const actualNet = await claimPayout(
        trader, traderAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault,
      );
      expect(actualNet.toString()).to.equal(
        expectedNet.toString(),
        `K1 payout mismatch: expected ${expectedNet}, got ${actualNet} (w=${w}, sf=${sfOnChain})`,
      );

      // LP residual: creator removes all shares — the leftover floor stays in
      // the vault, but vault MUST be solvent (>= 0 leftover). With fee=0 the
      // post-everyone-claims vault balance equals zero (modulo per-bin floor).
      const creatorAta = await getOrCreateAta(
        ctx.collateralMint, ctx.creatorKp.publicKey, ctx.creatorKp,
      );
      const lpPayout = await removeLiquidity(
        ctx.creatorKp, creatorAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault,
      );
      expect(lpPayout >= ZERO).to.equal(true);

      const vaultAfter = await getVaultBalance(mkt.vault);
      // Redemption-fee=0 → protocol_fee_accumulated stays at whatever was
      // accrued during trades. The vault must hold at least that amount.
      const marketFinal = await ctx.program.account.market.fetch(mkt.marketPda);
      const protocolFees = BigInt(marketFinal.protocolFeeAccumulated.toString());
      expect(vaultAfter >= protocolFees).to.equal(
        true,
        `K1 vault insolvent: vault=${vaultAfter}, protocolFees=${protocolFees}`,
      );
    });
  });

  // ── K2 ──────────────────────────────────────────────────────────
  // Three traders concentrated near the winning bin so raw kernel
  // claims overshoot total_minted comfortably. Asserts scaling actually
  // engaged (sf < SCALE) and the vault is exactly solvent after every
  // claim. Width is PINNED at 4 — see the spec rationale: randomizing
  // would introduce a flake vector where an unlucky width leaves the
  // trigger un-pulled.
  describe("K2: kernel solvency — scaling triggers", () => {
    const NUM_BINS = 16;
    const RANGE_MIN = new BN(0).mul(SCALE);
    const RANGE_MAX = new BN(1600).mul(SCALE);
    const W = 4;

    it(`three concentrated traders force sf < SCALE (kernel_width=${W})`, async () => {
      const mkt = await createContinuousMarket({
        numBins: NUM_BINS,
        rangeMin: RANGE_MIN,
        rangeMax: RANGE_MAX,
        deadline: Math.floor(Date.now() / 1000) + 18,
        // Small initial liquidity + large trades = trader holdings overshoot
        // vault after kernel weighting. Concretely: 3M init + 3 * 8M trades
        // = 27M total_minted; each trader's holdings[winBin] ≈ 5M+, so
        // kernel-weighted raw_claims at W=4 (kernel support = 9 bins)
        // comfortably exceeds total_minted.
        liquidity: new BN(3_000_000),
        kernelWidth: W,
      });

      const traders: Keypair[] = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
      const atas: PublicKey[] = [];
      for (const t of traders) {
        atas.push(await fundTrader(t));
      }

      const winValue = valueAtBin(RANGE_MIN, RANGE_MAX, NUM_BINS, 8); // bin 8 midpoint
      const sigma = new BN(50).mul(SCALE); // narrow Gaussian → concentration in bins 7-9

      for (let i = 0; i < traders.length; i++) {
        await buyDistribution(
          traders[i], atas[i], mkt.marketPda, mkt.vaultAuthority, mkt.vault,
          winValue, sigma, new BN(8_000_000),
        );
      }

      const holdingsPerTrader: bigint[][] = [];
      for (const t of traders) {
        holdingsPerTrader.push(await fetchHoldings(mkt.marketPda, t.publicKey));
      }

      await waitForDeadline(mkt.marketPda);
      await resolveMarket(mkt.marketPda, winValue);

      const market = await ctx.program.account.market.fetch(mkt.marketPda);
      const win = market.resolvedOutcome;
      const sf = BigInt(market.scalingFactor.toString());

      // Load-bearing assertion: scaling actually triggered. If this fires
      // negatively the fixture is under-concentrated — fix the fixture
      // (NOT the pinned width, per P5-2d).
      expect(sf < SCALE_BIG).to.equal(
        true,
        `K2 fixture under-concentrated: sf=${sf} stayed at SCALE; ` +
        `tighten the fixture (more traders, larger trades, or smaller liquidity)`,
      );

      const vaultBeforeClaims = await getVaultBalance(mkt.vault);

      // Every trader claims; payouts must match the per-trader kernel formula
      // computed against the on-chain scaling factor.
      let totalClaimed = ZERO;
      for (let i = 0; i < traders.length; i++) {
        const expected = computeKernelPayout(holdingsPerTrader[i], win, W, sf);
        const actual = await claimPayout(
          traders[i], atas[i], mkt.marketPda, mkt.vaultAuthority, mkt.vault,
        );
        expect(actual.toString()).to.equal(
          expected.toString(),
          `K2 trader ${i} payout mismatch: expected ${expected}, got ${actual}`,
        );
        totalClaimed += actual;
      }

      // LP removes residual — for a heavily-diluted resolution this is
      // (per-bin floor leftover), should be ≈ 0.
      const creatorAta = await getOrCreateAta(
        ctx.collateralMint, ctx.creatorKp.publicKey, ctx.creatorKp,
      );
      const lpPayout = await removeLiquidity(
        ctx.creatorKp, creatorAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault,
      );

      const vaultAfter = await getVaultBalance(mkt.vault);
      const marketFinal = await ctx.program.account.market.fetch(mkt.marketPda);
      const protocolFees = BigInt(marketFinal.protocolFeeAccumulated.toString());

      // Σ payouts + lp_payout + remaining_vault == vault before claims started.
      // remaining_vault is the protocol fees (untouched by claim/remove).
      expect((totalClaimed + lpPayout + (vaultAfter - protocolFees)).toString()).to.equal(
        (vaultBeforeClaims - protocolFees).toString(),
        `K2 solvency violated: agg=${totalClaimed} lp=${lpPayout} ` +
        `vaultLeftover=${vaultAfter - protocolFees} != ` +
        `vaultBeforeClaims-fees=${vaultBeforeClaims - protocolFees}`,
      );
      expect(vaultAfter >= protocolFees).to.equal(
        true, `vault must remain ≥ protocol_fees: vault=${vaultAfter}, fees=${protocolFees}`,
      );
    });
  });

  // ── K3 ──────────────────────────────────────────────────────────
  // Tiny holdings vs vault — `raw_claims < total_minted` → `sf == SCALE`.
  // With width=1 and a single bin holding, payout collapses to
  // `holdings[winBin]` exactly (K(win,win,1)=1, no neighbors contribute,
  // sf=SCALE, fee=0).
  describe("K3: kernel with no scaling needed", () => {
    const NUM_BINS = 16;
    const RANGE_MIN = new BN(0).mul(SCALE);
    const RANGE_MAX = new BN(300).mul(SCALE);
    const W = 1;

    it(`tiny trader, single-bin Gaussian (kernel_width=${W})`, async () => {
      const mkt = await createContinuousMarket({
        numBins: NUM_BINS,
        rangeMin: RANGE_MIN,
        rangeMax: RANGE_MAX,
        deadline: Math.floor(Date.now() / 1000) + 12,
        liquidity: new BN(30_000_000),
        kernelWidth: W,
      });

      const trader = Keypair.generate();
      const traderAta = await fundTrader(trader);
      const winValue = valueAtBin(RANGE_MIN, RANGE_MAX, NUM_BINS, 8);

      // Tiny purchase + narrow sigma → holdings concentrate in bin 8.
      await buyDistribution(
        trader, traderAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault,
        winValue, new BN(2).mul(SCALE), new BN(500_000),
      );

      const holdings = await fetchHoldings(mkt.marketPda, trader.publicKey);

      await waitForDeadline(mkt.marketPda);
      await resolveMarket(mkt.marketPda, winValue);

      const market = await ctx.program.account.market.fetch(mkt.marketPda);
      const win = market.resolvedOutcome;
      const sf = BigInt(market.scalingFactor.toString());

      expect(sf.toString()).to.equal(
        SCALE_BIG.toString(),
        `K3 sf should be exactly SCALE (no dilution path): got ${sf}`,
      );

      const expected = computeKernelPayout(holdings, win, W, sf);
      const actual = await claimPayout(
        trader, traderAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault,
      );
      expect(actual.toString()).to.equal(
        expected.toString(),
        `K3 payout mismatch: expected ${expected}, got ${actual}`,
      );
    });
  });

  // ── K4 ──────────────────────────────────────────────────────────
  // Trader A's holdings live entirely outside the kernel's support
  // (in bins 0-5, far from the resolved bin 32). Even with width=10
  // the kernel reaches at most bin 22, so every weight evaluates to 0
  // → claim must revert with NothingToClaim. Trader B (centered on
  // the winning bin) claims successfully — confirms only the outside
  // trader is rejected.
  describe("K4: trader outside kernel range", () => {
    const NUM_BINS = 64;
    const RANGE_MIN = new BN(0).mul(SCALE);
    const RANGE_MAX = new BN(640).mul(SCALE);
    const w = pickWidth(NUM_BINS);

    it(`outside trader → NothingToClaim (kernel_width=${w})`, async () => {
      const mkt = await createContinuousMarket({
        numBins: NUM_BINS,
        rangeMin: RANGE_MIN,
        rangeMax: RANGE_MAX,
        deadline: Math.floor(Date.now() / 1000) + 15,
        liquidity: new BN(20_000_000),
        kernelWidth: w,
      });

      const traderA = Keypair.generate();
      const traderB = Keypair.generate();
      const ataA = await fundTrader(traderA);
      const ataB = await fundTrader(traderB);

      // A buys at value=20 (bin ~2), well outside any kernel support
      // centered on bin 32 for widths up to 10 (support reaches bin 22).
      await buyDistribution(
        traderA, ataA, mkt.marketPda, mkt.vaultAuthority, mkt.vault,
        new BN(20).mul(SCALE), new BN(8).mul(SCALE), new BN(3_000_000),
      );
      // B buys at value=320 (bin 32) — inside any kernel support.
      const winValue = valueAtBin(RANGE_MIN, RANGE_MAX, NUM_BINS, 32);
      await buyDistribution(
        traderB, ataB, mkt.marketPda, mkt.vaultAuthority, mkt.vault,
        winValue, new BN(8).mul(SCALE), new BN(3_000_000),
      );

      await waitForDeadline(mkt.marketPda);
      await resolveMarket(mkt.marketPda, winValue);

      // B claims successfully.
      const before = await getAccount(ctx.provider.connection, ataB);
      await claimPayout(traderB, ataB, mkt.marketPda, mkt.vaultAuthority, mkt.vault);
      const after = await getAccount(ctx.provider.connection, ataB);
      expect(after.amount > before.amount).to.equal(true, "B should have received payout");

      // A's holdings are all outside the kernel — claim must revert.
      let threwAsExpected = false;
      try {
        await claimPayout(traderA, ataA, mkt.marketPda, mkt.vaultAuthority, mkt.vault);
      } catch (err: any) {
        threwAsExpected = err.toString().includes("NothingToClaim");
      }
      expect(threwAsExpected).to.equal(
        true,
        `K4: A's claim should revert with NothingToClaim (kernel_width=${w})`,
      );
    });
  });

  // ── K5 ──────────────────────────────────────────────────────────
  // Winner at bin 0: kernel extends only rightward (no underflow
  // because `kernel_weight` uses unsigned abs_diff). Different code
  // surface from P5-1 test 6 — that's the pure-Rust resolve unit; this
  // exercises the live `claim_payout` instruction against a truncated
  // holdings slice.
  describe("K5: kernel — boundary resolution (bin 0)", () => {
    const NUM_BINS = 16;
    const RANGE_MIN = new BN(0).mul(SCALE);
    const RANGE_MAX = new BN(160).mul(SCALE);
    const w = pickWidth(NUM_BINS);

    it(`winner at bin 0, kernel truncated left (kernel_width=${w})`, async () => {
      const mkt = await createContinuousMarket({
        numBins: NUM_BINS,
        rangeMin: RANGE_MIN,
        rangeMax: RANGE_MAX,
        deadline: Math.floor(Date.now() / 1000) + 12,
        liquidity: new BN(20_000_000),
        kernelWidth: w,
      });

      const trader = Keypair.generate();
      const traderAta = await fundTrader(trader);
      const winValue = valueAtBin(RANGE_MIN, RANGE_MAX, NUM_BINS, 0);

      // Distribution centered at bin 0 — most holdings in bins 0-4.
      await buyDistribution(
        trader, traderAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault,
        winValue, new BN(15).mul(SCALE), new BN(3_000_000),
      );

      const holdings = await fetchHoldings(mkt.marketPda, trader.publicKey);

      await waitForDeadline(mkt.marketPda);
      await resolveMarket(mkt.marketPda, RANGE_MIN); // exactly range_min → bin 0

      const market = await ctx.program.account.market.fetch(mkt.marketPda);
      expect(market.resolvedOutcome).to.equal(0, "value=range_min must resolve to bin 0");
      const sf = BigInt(market.scalingFactor.toString());

      const expected = computeKernelPayout(holdings, 0, w, sf);
      const actual = await claimPayout(
        trader, traderAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault,
      );
      expect(actual.toString()).to.equal(
        expected.toString(),
        `K5 payout mismatch: expected ${expected}, got ${actual}`,
      );
    });
  });

  // ── K6 ──────────────────────────────────────────────────────────
  // Symmetric to K5: winner at the last bin, kernel truncated right.
  describe("K6: kernel — boundary resolution (last bin)", () => {
    const NUM_BINS = 16;
    const RANGE_MIN = new BN(0).mul(SCALE);
    const RANGE_MAX = new BN(160).mul(SCALE);
    const w = pickWidth(NUM_BINS);

    it(`winner at last bin, kernel truncated right (kernel_width=${w})`, async () => {
      const mkt = await createContinuousMarket({
        numBins: NUM_BINS,
        rangeMin: RANGE_MIN,
        rangeMax: RANGE_MAX,
        deadline: Math.floor(Date.now() / 1000) + 12,
        liquidity: new BN(20_000_000),
        kernelWidth: w,
      });

      const trader = Keypair.generate();
      const traderAta = await fundTrader(trader);
      const winValue = valueAtBin(RANGE_MIN, RANGE_MAX, NUM_BINS, NUM_BINS - 1);

      await buyDistribution(
        trader, traderAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault,
        winValue, new BN(15).mul(SCALE), new BN(3_000_000),
      );

      const holdings = await fetchHoldings(mkt.marketPda, trader.publicKey);

      await waitForDeadline(mkt.marketPda);
      await resolveMarket(mkt.marketPda, RANGE_MAX);

      const market = await ctx.program.account.market.fetch(mkt.marketPda);
      expect(market.resolvedOutcome).to.equal(NUM_BINS - 1);
      const sf = BigInt(market.scalingFactor.toString());

      const expected = computeKernelPayout(holdings, NUM_BINS - 1, w, sf);
      const actual = await claimPayout(
        trader, traderAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault,
      );
      expect(actual.toString()).to.equal(
        expected.toString(),
        `K6 payout mismatch: expected ${expected}, got ${actual}`,
      );
    });
  });

  // ── K7 ──────────────────────────────────────────────────────────
  // Order-independence: trader-then-LPs vs LP-then-trader-then-LP must
  // produce the same final vault balance. Implemented as two
  // independently-created markets with identical fixtures (a true
  // "fresh fork" isn't available on a live validator).
  //
  // **One pickWidth call shared between both sub-runs.** Encoding the
  // width as a single `const` (not two independent draws) makes a
  // width-mismatch impossible — a mismatch would otherwise masquerade
  // as the very order-dependence bug this test exists to detect.
  describe("K7: kernel — LP removal order independence", () => {
    const NUM_BINS = 16;
    const RANGE_MIN = new BN(0).mul(SCALE);
    const RANGE_MAX = new BN(160).mul(SCALE);
    const w = pickWidth(NUM_BINS); // ← shared between (a) and (b)

    async function runScenario(orderTraderFirst: boolean): Promise<bigint> {
      const mkt = await createContinuousMarket({
        numBins: NUM_BINS,
        rangeMin: RANGE_MIN,
        rangeMax: RANGE_MAX,
        deadline: Math.floor(Date.now() / 1000) + 15,
        liquidity: new BN(10_000_000),
        kernelWidth: w,
      });

      // Second LP joins so the test really has 2 LPs.
      const lp2 = Keypair.generate();
      const lp2Ata = await fundTrader(lp2);
      await addLiquidity(
        lp2, lp2Ata, mkt.marketPda, mkt.vaultAuthority, mkt.vault, new BN(5_000_000),
      );

      const trader = Keypair.generate();
      const traderAta = await fundTrader(trader);
      const winValue = valueAtBin(RANGE_MIN, RANGE_MAX, NUM_BINS, 8);
      await buyDistribution(
        trader, traderAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault,
        winValue, new BN(15).mul(SCALE), new BN(3_000_000),
      );

      await waitForDeadline(mkt.marketPda);
      await resolveMarket(mkt.marketPda, winValue);

      const creatorAta = await getOrCreateAta(
        ctx.collateralMint, ctx.creatorKp.publicKey, ctx.creatorKp,
      );

      if (orderTraderFirst) {
        // (a) trader claims → LP1 (creator) removes → LP2 removes
        await claimPayout(trader, traderAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault);
        await removeLiquidity(
          ctx.creatorKp, creatorAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault,
        );
        await removeLiquidity(
          lp2, lp2Ata, mkt.marketPda, mkt.vaultAuthority, mkt.vault,
        );
      } else {
        // (b) LP1 removes → trader claims → LP2 removes
        await removeLiquidity(
          ctx.creatorKp, creatorAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault,
        );
        await claimPayout(trader, traderAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault);
        await removeLiquidity(
          lp2, lp2Ata, mkt.marketPda, mkt.vaultAuthority, mkt.vault,
        );
      }

      const marketFinal = await ctx.program.account.market.fetch(mkt.marketPda);
      const vaultFinal = await getVaultBalance(mkt.vault);
      // Subtract protocol fees so we compare apples to apples — protocol
      // fee accrual is unaffected by order, but we want to see the
      // post-claim residual specifically.
      return vaultFinal - BigInt(marketFinal.protocolFeeAccumulated.toString());
    }

    it(`vault residual identical under both orders (kernel_width=${w})`, async () => {
      const residualA = await runScenario(true);
      const residualB = await runScenario(false);
      expect(residualA.toString()).to.equal(
        residualB.toString(),
        `K7: vault residual differs by order — (trader→LP→LP)=${residualA} ` +
        `vs (LP→trader→LP)=${residualB} (kernel_width=${w})`,
      );
    });
  });

  // ── K8 ──────────────────────────────────────────────────────────
  // `kernel_width = 0` on a continuous market MUST take the WTA branch
  // in `claim_payout`. This is the upgrade-regression contract that
  // protects markets created before the smooth-kernel refactor (their
  // padding bytes deserialize as 0, putting them on this branch).
  //
  // Owner policy (2026-05-31): K8 is the only WTA-mode scenario in
  // this file. New kernel invariants are NOT backported to WTA. See
  // the file-level comment and the wta-backward-compat-policy memory.
  describe("K8: kernel_width=0 on continuous market = WTA", () => {
    const NUM_BINS = 16;
    const RANGE_MIN = new BN(0).mul(SCALE);
    const RANGE_MAX = new BN(160).mul(SCALE);

    it("WTA branch — payout equals raw holdings on win bin (kernel_width=0)", async () => {
      const mkt = await createContinuousMarket({
        numBins: NUM_BINS,
        rangeMin: RANGE_MIN,
        rangeMax: RANGE_MAX,
        deadline: Math.floor(Date.now() / 1000) + 12,
        liquidity: new BN(20_000_000),
        kernelWidth: 0,
      });

      const trader = Keypair.generate();
      const traderAta = await fundTrader(trader);
      const winValue = valueAtBin(RANGE_MIN, RANGE_MAX, NUM_BINS, 8);

      await buyDistribution(
        trader, traderAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault,
        winValue, new BN(15).mul(SCALE), new BN(3_000_000),
      );

      const holdings = await fetchHoldings(mkt.marketPda, trader.publicKey);

      await waitForDeadline(mkt.marketPda);
      await resolveMarket(mkt.marketPda, winValue);

      const market = await ctx.program.account.market.fetch(mkt.marketPda);
      const win = market.resolvedOutcome;

      // scaling_factor stays 0 (resolve's WTA branch never touches it).
      expect(market.scalingFactor.toString()).to.equal(
        "0",
        "K8 WTA branch must leave scaling_factor at 0 (got " +
        market.scalingFactor.toString() + ")",
      );

      const payout = await claimPayout(
        trader, traderAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault,
      );
      expect(payout.toString()).to.equal(
        holdings[win].toString(),
        `K8: WTA payout must equal raw holdings[${win}]=${holdings[win]}, got ${payout}`,
      );
    });
  });

  // ── K9 ──────────────────────────────────────────────────────────
  // `kernel_width = num_bins - 1` is the maximum value `initialize()`
  // accepts (the validator is `kernel_width < num_outcomes`). Verifies
  // (a) market creation succeeds at the boundary and (b) the resulting
  // resolution remains exactly solvent. `scaling_factor` is fixture-
  // dependent at this width (the kernel reaches every bin) so we don't
  // pin its value — load-bearing checks are creation-success and
  // exact solvency.
  describe("K9: kernel — maximum legal width", () => {
    const NUM_BINS = 16;
    const RANGE_MIN = new BN(0).mul(SCALE);
    const RANGE_MAX = new BN(160).mul(SCALE);
    const W = NUM_BINS - 1; // 15

    before(() => {
      // Trace-only reserve: keeps the picker's `used` set honest if any
      // future scenario reads it for debugging.
      pickWidth.reserve(W);
    });

    it(`max width = num_bins - 1 = ${W}`, async () => {
      // Load-bearing assertion #1: create succeeds at the boundary.
      const mkt = await createContinuousMarket({
        numBins: NUM_BINS,
        rangeMin: RANGE_MIN,
        rangeMax: RANGE_MAX,
        deadline: Math.floor(Date.now() / 1000) + 15,
        liquidity: new BN(20_000_000),
        kernelWidth: W,
      });

      const marketAfterCreate = await ctx.program.account.market.fetch(mkt.marketPda);
      expect(marketAfterCreate.kernelWidth).to.equal(
        W, `K9: kernel_width must persist at max boundary (got ${marketAfterCreate.kernelWidth})`,
      );

      const t1 = Keypair.generate();
      const t2 = Keypair.generate();
      const a1 = await fundTrader(t1);
      const a2 = await fundTrader(t2);
      const winValue = valueAtBin(RANGE_MIN, RANGE_MAX, NUM_BINS, 8);

      await buyDistribution(
        t1, a1, mkt.marketPda, mkt.vaultAuthority, mkt.vault,
        new BN(40).mul(SCALE), new BN(20).mul(SCALE), new BN(3_000_000),
      );
      await buyDistribution(
        t2, a2, mkt.marketPda, mkt.vaultAuthority, mkt.vault,
        new BN(120).mul(SCALE), new BN(20).mul(SCALE), new BN(3_000_000),
      );

      const h1 = await fetchHoldings(mkt.marketPda, t1.publicKey);
      const h2 = await fetchHoldings(mkt.marketPda, t2.publicKey);

      await waitForDeadline(mkt.marketPda);
      await resolveMarket(mkt.marketPda, winValue);

      const market = await ctx.program.account.market.fetch(mkt.marketPda);
      const win = market.resolvedOutcome;
      const sf = BigInt(market.scalingFactor.toString());

      // Per-trader payouts match the formula.
      const expected1 = computeKernelPayout(h1, win, W, sf);
      const expected2 = computeKernelPayout(h2, win, W, sf);

      const vaultBefore = await getVaultBalance(mkt.vault);
      const protoBefore = BigInt(market.protocolFeeAccumulated.toString());

      let p1 = ZERO;
      try {
        p1 = await claimPayout(t1, a1, mkt.marketPda, mkt.vaultAuthority, mkt.vault);
      } catch (err: any) {
        // t1 may have no holdings in the kernel's support if its Gaussian
        // didn't reach bin 8 — at W=15 the support is every bin, so this
        // should not happen unless expected1 itself is 0.
        expect(err.toString()).to.include("NothingToClaim");
        expect(expected1.toString()).to.equal("0", "t1 claim revert vs nonzero expected payout");
      }
      let p2 = ZERO;
      try {
        p2 = await claimPayout(t2, a2, mkt.marketPda, mkt.vaultAuthority, mkt.vault);
      } catch (err: any) {
        expect(err.toString()).to.include("NothingToClaim");
        expect(expected2.toString()).to.equal("0", "t2 claim revert vs nonzero expected payout");
      }
      if (expected1 > ZERO) expect(p1.toString()).to.equal(expected1.toString());
      if (expected2 > ZERO) expect(p2.toString()).to.equal(expected2.toString());

      const creatorAta = await getOrCreateAta(
        ctx.collateralMint, ctx.creatorKp.publicKey, ctx.creatorKp,
      );
      const lpPayout = await removeLiquidity(
        ctx.creatorKp, creatorAta, mkt.marketPda, mkt.vaultAuthority, mkt.vault,
      );

      const marketFinal = await ctx.program.account.market.fetch(mkt.marketPda);
      const vaultAfter = await getVaultBalance(mkt.vault);
      const protoAfter = BigInt(marketFinal.protocolFeeAccumulated.toString());
      // Protocol fees did not change after resolve (fee=0 on claims).
      expect(protoAfter.toString()).to.equal(protoBefore.toString());

      // Load-bearing assertion #2: exact solvency. Vault before claims
      // == agg trader claims + LP payout + remaining vault.
      const accounted = p1 + p2 + lpPayout + vaultAfter;
      expect(accounted.toString()).to.equal(
        vaultBefore.toString(),
        `K9 solvency violated: p1=${p1} p2=${p2} lp=${lpPayout} ` +
        `vaultAfter=${vaultAfter} != vaultBefore=${vaultBefore}`,
      );
    });
  });
});
