import {
  MarketState,
  MarketType,
  SCALE,
  USDC_DECIMALS,
  computeProbabilities,
  type UserPosition,
  type Trade,
} from "./types";

// ── Constants ──

/** Default trade fee in basis points (0.3%). */
export const DEFAULT_TRADE_FEE_BPS = 30;

// ── AMM sell simulation ──

/**
 * Simulates selling all holdings through the L2-norm AMM and returns
 * total net proceeds after fees. Sells each outcome sequentially,
 * updating pool state between sells.
 *
 * This matches the on-chain compute_sell + compute_fees flow.
 */
export function computeAmmSellProceeds(
  reserves: string[],
  totalMinted: string,
  holdings: number[],
  feeBps: number = DEFAULT_TRADE_FEE_BPS,
): number {
  const res = reserves.map((r) => Number(r));
  let tm = Number(totalMinted);
  let totalNet = 0;

  for (let i = 0; i < holdings.length; i++) {
    const tokensIn = holdings[i];
    if (tokensIn <= 0) continue;

    const xI = tm - res[i];
    if (xI < tokensIn) continue; // Can't sell more than circulating supply

    // Return tokens to pool
    res[i] += tokensIn;

    // Compute new L2-norm
    let kNewSq = 0;
    for (let j = 0; j < res.length; j++) {
      const x = tm - res[j];
      kNewSq += x * x;
    }
    const kNew = Math.sqrt(kNewSq);
    const grossCollateral = Math.max(0, Math.floor(tm - kNew));

    // Apply trading fee
    const fee = Math.floor((grossCollateral * feeBps) / 10_000);
    totalNet += grossCollateral - fee;

    // Update pool state: totalMinted and all reserves decrease by grossCollateral
    tm -= grossCollateral;
    for (let j = 0; j < res.length; j++) {
      res[j] -= grossCollateral;
    }
  }

  return totalNet;
}

// ── Position value computation ──

/**
 * Computes the liquidation value of a position (what you'd get selling now).
 * For resolved markets: value = winning tokens (face value claim).
 * For active/expired markets: value = AMM sell proceeds after fees.
 */
export function computePositionValue(pos: UserPosition): number {
  const { market } = pos;
  const holdings = pos.holdings.map((h) => Number(h));

  if (market.state === MarketState.Resolved) {
    return computeResolvedValue(holdings, market);
  }

  return computeAmmSellProceeds(market.reserves, market.totalMinted, holdings);
}

function computeResolvedValue(
  holdings: number[],
  market: UserPosition["market"],
): number {
  // Continuous markets: route through the kernel branch when the market
  // opted into smooth settlement (`kernelWidth > 0`). Pre-kernel markets
  // (and any explicitly-WTA continuous market) still pay `holdings[winBin]`.
  if (market.marketType === MarketType.Continuous) {
    const winBin = continuousWinBin(market);
    if (winBin == null) return 0;
    if ((market.kernelWidth ?? 0) > 0) {
      return computeKernelPayout(
        holdings,
        winBin,
        market.kernelWidth!,
        market.scalingFactor ?? "0",
      );
    }
    return holdings[winBin] ?? 0;
  }
  // Binary / multi: winner takes all, indexed by resolvedOutcome.
  if (market.resolvedOutcome != null) {
    return holdings[market.resolvedOutcome] ?? 0;
  }
  return 0;
}

/**
 * Resolves a continuous market's winning bin. Prefers the on-chain
 * `resolvedOutcome` (set by `value_to_bin` during `resolve()`); falls back
 * to re-deriving from `resolvedValue + rangeMin/Max` for any market whose
 * indexer projection predates that field being surfaced.
 */
function continuousWinBin(market: UserPosition["market"]): number | null {
  if (market.resolvedOutcome != null) return market.resolvedOutcome;
  if (
    market.resolvedValue != null &&
    market.rangeMin != null &&
    market.rangeMax != null
  ) {
    const resolved = Number(market.resolvedValue) / SCALE;
    const rMin = Number(market.rangeMin) / SCALE;
    const rMax = Number(market.rangeMax) / SCALE;
    const binWidth = (rMax - rMin) / market.numOutcomes;
    return Math.max(
      0,
      Math.min(
        Math.floor((resolved - rMin) / binWidth),
        market.numOutcomes - 1,
      ),
    );
  }
  return null;
}

// ── Kernel payout (continuous markets, kernel_width > 0) ──

const SCALE_BIG = BigInt(SCALE);
const ZERO_BIG = BigInt(0);
const ONE_BIG = BigInt(1);

/** Triangular kernel weight K(i, win, w) scaled to SCALE. */
function kernelWeight(i: number, win: number, kernelWidth: number): bigint {
  const d = BigInt(Math.abs(i - win));
  const w = BigInt(kernelWidth);
  if (d > w) return ZERO_BIG;
  const denom = w + ONE_BIG;
  return (SCALE_BIG * (denom - d)) / denom;
}

/**
 * Mirrors on-chain `compute_kernel_payout` (engine/kernel.rs) bit-for-bit:
 *
 *   raw    = Σ_i floor( holdings[i] * K(i, win, w) / SCALE )
 *   payout = floor( raw * scalingFactor / SCALE )
 *
 * Uses BigInt throughout — `number` desyncs from the u128 chain math
 * once `holdings × kernel × scalingFactor` crosses ~2^53.
 */
export function computeKernelPayout(
  holdings: number[],
  winBin: number,
  kernelWidth: number,
  scalingFactor: string,
): number {
  let raw = ZERO_BIG;
  for (let i = 0; i < holdings.length; i++) {
    const h = holdings[i];
    if (!h) continue;
    const weight = kernelWeight(i, winBin, kernelWidth);
    if (weight === ZERO_BIG) continue;
    raw += (BigInt(h) * weight) / SCALE_BIG;
  }
  const sf = BigInt(scalingFactor);
  return Number((raw * sf) / SCALE_BIG);
}

/**
 * Per-winning-bin payout array, assuming `scaling_factor = SCALE` (upper bound).
 * Pre-resolution we don't know the real `scaling_factor` — at claim time the
 * chain may scale this down by `s / SCALE` where `s ∈ [0, SCALE]`. So treat
 * the values returned here as a best-case ceiling, not a guarantee.
 *
 * Falls back to `holdings.slice()` when `kernelWidth = 0` (pure WTA):
 * `K(i, w, 0) = SCALE` iff `i == w`, else 0 → payout if bin w wins = holdings[w].
 */
export function kernelPayoutPerWin(
  holdings: number[],
  kernelWidth: number,
): number[] {
  const n = holdings.length;
  if (kernelWidth <= 0) return holdings.slice();
  const out = new Array<number>(n);
  for (let w = 0; w < n; w++) {
    let acc = ZERO_BIG;
    for (let i = 0; i < n; i++) {
      const h = holdings[i];
      if (!h) continue;
      const weight = kernelWeight(i, w, kernelWidth);
      if (weight === ZERO_BIG) continue;
      acc += (BigInt(h) * weight) / SCALE_BIG;
    }
    out[w] = Number(acc);
  }
  return out;
}

/**
 * Estimate the per-bin scaling factor `s_w` the program will apply if bin
 * `w` resolves as the winner. Mirrors `engine::kernel::compute_scaling_factor`:
 *
 *   raw_w = Σ_j floor( trader_totals[j] * K(j, w, kernelWidth) / SCALE )
 *   s_w   = min(SCALE, totalMinted * SCALE / raw_w)   (SCALE when raw_w == 0)
 *
 * The chain freezes `trader_totals` at `transition_to_pending`, so an estimate
 * from current state matches the resolution-time value *unless* trades land
 * between the preview and the resolve call. That's the same drift the
 * gross-payout preview already had; this estimator only ever reduces the
 * shown number, never inflates it past `s = SCALE` (the prior upper bound).
 *
 * Returns SCALE (no dilution) when:
 *   - kernelWidth == 0 (WTA — s is unused; `claim_payout` reads holdings[win])
 *   - traderTotals is empty / all zero (no claims to dilute)
 *   - totalMinted is 0 (degenerate; preview falls back to gross)
 */
export function estimateScalingFactor(
  traderTotals: number[],
  winBin: number,
  kernelWidth: number,
  totalMinted: number,
): bigint {
  if (kernelWidth <= 0) return SCALE_BIG;
  if (!traderTotals.length || totalMinted <= 0) return SCALE_BIG;

  let raw = ZERO_BIG;
  for (let j = 0; j < traderTotals.length; j++) {
    const t = traderTotals[j];
    if (!t) continue;
    const weight = kernelWeight(j, winBin, kernelWidth);
    if (weight === ZERO_BIG) continue;
    raw += (BigInt(t) * weight) / SCALE_BIG;
  }
  if (raw === ZERO_BIG) return SCALE_BIG;

  const cap = (BigInt(totalMinted) * SCALE_BIG) / raw;
  return cap < SCALE_BIG ? cap : SCALE_BIG;
}

/**
 * Per-winning-bin payout array, estimating `scaling_factor` per bin from the
 * provided `traderTotals` snapshot. Returns the same shape as
 * `kernelPayoutPerWin` but each entry is `floor(gross_w * s_w / SCALE)` —
 * i.e. what the chain would actually pay if bin `w` won *given current
 * trader totals*.
 *
 * When `traderTotals` is missing (empty / undefined), every `s_w` is `SCALE`
 * and the result equals `kernelPayoutPerWin(holdings, kernelWidth)` — same
 * upper-bound behaviour as before this estimator existed.
 */
export function kernelPayoutPerWinEstimated(
  holdings: number[],
  kernelWidth: number,
  traderTotals: number[] | undefined,
  totalMinted: number,
): number[] {
  const n = holdings.length;
  if (kernelWidth <= 0) return holdings.slice();
  const totals = traderTotals && traderTotals.length === n ? traderTotals : [];
  const out = new Array<number>(n);
  for (let w = 0; w < n; w++) {
    let gross = ZERO_BIG;
    for (let i = 0; i < n; i++) {
      const h = holdings[i];
      if (!h) continue;
      const weight = kernelWeight(i, w, kernelWidth);
      if (weight === ZERO_BIG) continue;
      gross += (BigInt(h) * weight) / SCALE_BIG;
    }
    const s = estimateScalingFactor(totals, w, kernelWidth, totalMinted);
    out[w] = Number((gross * s) / SCALE_BIG);
  }
  return out;
}

/**
 * Best-case payout across all possible winning bins, kernel-aware.
 * For `kernelWidth = 0` this is just `max(holdings)` (WTA). For kernel
 * markets it's `max_w (Σ_i holdings[i] · K(i, w, W)) · s_w / SCALE`, where
 * `s_w` is estimated from `traderTotals + totalMinted` when provided
 * (matching what `claim_payout` would actually pay), or the SCALE upper
 * bound when those aren't available.
 */
export function computeKernelPeakPayout(
  holdings: number[],
  kernelWidth: number,
  traderTotals?: number[],
  totalMinted?: number,
): number {
  const perWin =
    traderTotals && totalMinted != null
      ? kernelPayoutPerWinEstimated(holdings, kernelWidth, traderTotals, totalMinted)
      : kernelPayoutPerWin(holdings, kernelWidth);
  return perWin.length ? Math.max(...perWin) : 0;
}

// ── Position range helpers (for continuous markets) ──

/** Returns the bin indices that have non-zero holdings */
function getNonZeroBinRange(holdings: number[]): { start: number; end: number } | null {
  let start = -1;
  let end = -1;
  for (let i = 0; i < holdings.length; i++) {
    if (holdings[i] > 0) {
      if (start === -1) start = i;
      end = i;
    }
  }
  if (start === -1) return null;
  return { start, end };
}

/** Converts a bin index to the real-world value at that bin's start */
function binToValue(
  binIndex: number,
  numOutcomes: number,
  rangeMin: number,
  rangeMax: number,
): number {
  const binWidth = (rangeMax - rangeMin) / numOutcomes;
  return rangeMin + binIndex * binWidth;
}

/** Get the position range as real-world values for display */
export function getPositionRange(
  pos: UserPosition,
): { min: number; max: number } | null {
  const { market } = pos;
  if (market.marketType !== MarketType.Continuous) return null;
  if (market.rangeMin == null || market.rangeMax == null) return null;

  const holdings = pos.holdings.map((h) => Number(h));
  const range = getNonZeroBinRange(holdings);
  if (!range) return null;

  const rMin = Number(market.rangeMin) / SCALE;
  const rMax = Number(market.rangeMax) / SCALE;

  return {
    min: binToValue(range.start, market.numOutcomes, rMin, rMax),
    max: binToValue(range.end + 1, market.numOutcomes, rMin, rMax),
  };
}

// ── Portfolio-level calculations ──

export interface PortfolioTab {
  /** All tabs */
  all: UserPosition[];
  /** Markets that are Active or Paused (ongoing) */
  open: UserPosition[];
  /** Markets that are Resolved (settled) */
  settled: UserPosition[];
  /** Markets past deadline but NOT yet resolved */
  expired: UserPosition[];
}

export function categorizePositions(positions: UserPosition[]): PortfolioTab {
  const nonEmpty = positions.filter((p) =>
    p.holdings.some((h) => Number(h) > 0),
  );

  const open: UserPosition[] = [];
  const settled: UserPosition[] = [];
  const expired: UserPosition[] = [];

  for (const pos of nonEmpty) {
    const { market } = pos;
    if (market.state === MarketState.Resolved) {
      settled.push(pos);
    } else {
      const deadline = new Date(market.deadline).getTime();
      const isPastDeadline = deadline < Date.now();
      if (isPastDeadline) {
        expired.push(pos);
      } else {
        open.push(pos);
      }
    }
  }

  return { all: nonEmpty, open, settled, expired };
}

/**
 * Portfolio Value: Sum of liquidation values of all positions with holdings.
 * Includes active, expired, and settled (unclaimed) positions.
 */
export function computePortfolioValue(positions: UserPosition[]): number {
  let total = 0;
  for (const pos of positions) {
    total += computePositionValue(pos);
  }
  return total;
}

/**
 * Active Positions: Count of positions in markets that are not yet resolved.
 * Includes both open (ongoing) and expired (deadline passed, not resolved).
 */
export function computeActivePositionCount(
  open: UserPosition[],
  expired: UserPosition[],
): number {
  return open.length + expired.length;
}

/**
 * Win Rate: Among resolved (settled) positions, how many had payout > cost.
 * Win = resolved payout > totalDeposited - totalWithdrawn (net cost).
 */
export function computeWinRate(settledPositions: UserPosition[]): number {
  if (settledPositions.length === 0) return 0;

  let wins = 0;
  for (const pos of settledPositions) {
    const payout = computeResolvedValue(
      pos.holdings.map((h) => Number(h)),
      pos.market,
    );
    const netCost = Number(pos.totalDeposited) - Number(pos.totalWithdrawn);
    if (payout > netCost) wins++;
  }

  return wins / settledPositions.length;
}

// ── Risk Summary calculations ──

/**
 * Total at Risk: Sum of net costs for positions in undecided markets (open + expired).
 */
export function computeTotalAtRisk(
  open: UserPosition[],
  expired: UserPosition[],
): number {
  let total = 0;
  for (const pos of [...open, ...expired]) {
    const netCost = Number(pos.totalDeposited) - Number(pos.totalWithdrawn);
    total += Math.max(0, netCost);
  }
  return total;
}

/**
 * Max Potential Gain: For each undecided position, find the best-case net profit.
 * - WTA (binary/multi/continuous-with-kernelWidth=0): max bin payout = `max(holdings)`.
 * - Smooth kernel (continuous, kernelWidth>0): `max_w Σ_i holdings[i] · K(i,w,W)`
 *   assuming `scaling_factor = SCALE` (the pre-resolution upper bound — at claim
 *   time the chain may scale this down).
 */
export function computeMaxPotentialGain(
  open: UserPosition[],
  expired: UserPosition[],
): number {
  let total = 0;
  for (const pos of [...open, ...expired]) {
    const holdings = pos.holdings.map((h) => Number(h));
    const peak = bestCaseGrossPayout(holdings, pos.market);
    const netCost = Math.max(0, Number(pos.totalDeposited) - Number(pos.totalWithdrawn));
    total += Math.max(0, peak - netCost);
  }
  return total;
}

/** Best-case payout for a position, branching on kernel mode.
 *  When the market exposes `traderTokenTotals + totalMinted`, the kernel
 *  branch returns the estimated post-dilution payout (matches what the chain
 *  would actually pay at claim time) instead of the SCALE upper bound. */
function bestCaseGrossPayout(
  holdings: number[],
  market: UserPosition["market"],
): number {
  const w = market.kernelWidth ?? 0;
  if (market.marketType === MarketType.Continuous && w > 0) {
    const totals = (market.traderTokenTotals ?? []).map((t) => Number(t));
    return computeKernelPeakPayout(holdings, w, totals, Number(market.totalMinted));
  }
  return Math.max(...holdings, 0);
}

/**
 * Max Potential Loss: Sum of net costs for all undecided positions.
 * Worst case = user gets nothing back, losing everything paid.
 */
export function computeMaxPotentialLoss(
  open: UserPosition[],
  expired: UserPosition[],
): number {
  let total = 0;
  for (const pos of [...open, ...expired]) {
    const netCost = Number(pos.totalDeposited) - Number(pos.totalWithdrawn);
    total += Math.max(0, netCost);
  }
  return total;
}

/**
 * Overlapping Positions: Count pairs of positions in the same market
 * OR continuous positions whose bin ranges overlap.
 */
export function computeOverlappingPositions(positions: UserPosition[]): number {
  let pairs = 0;
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const a = positions[i];
      const b = positions[j];
      // Same market = overlapping
      if (a.marketId === b.marketId) {
        pairs++;
        continue;
      }
      // Different continuous markets: check if position ranges overlap
      if (
        a.market.marketType === MarketType.Continuous &&
        b.market.marketType === MarketType.Continuous
      ) {
        const rangeA = getPositionRange(a);
        const rangeB = getPositionRange(b);
        if (rangeA && rangeB) {
          if (rangeA.min < rangeB.max && rangeB.min < rangeA.max) {
            pairs++;
          }
        }
      }
    }
  }
  return pairs;
}

/**
 * Average Win Probability: For each undecided position,
 * compute the probability that its holdings would produce a positive return.
 * Uses current market probabilities weighted by which winning bins would clear
 * net cost. For kernel markets, neighbor bins contribute to payout via the
 * triangular kernel, so the profitability check is per-winning-bin total
 * payout, not the single bin's holding.
 */
export function computeAvgWinProbability(
  open: UserPosition[],
  expired: UserPosition[],
): number {
  const undecided = [...open, ...expired];
  if (undecided.length === 0) return 0;

  let totalProb = 0;
  for (const pos of undecided) {
    totalProb += positionWinProb(pos);
  }

  return totalProb / undecided.length;
}

// ── Per-position display helpers ──

/**
 * Compute current liquidation value for display in position row.
 */
export function computeCurrentValue(pos: UserPosition): number {
  return computePositionValue(pos);
}

/**
 * Compute PnL (profit and loss) for a position.
 * ProfitLoss = SellPrice - PaidPrice
 * P/L% = 100 × ProfitLoss / PaidPrice
 * where PaidPrice = totalDeposited - totalWithdrawn (net cost).
 */
export function computePnl(pos: UserPosition): { pnl: number; pnlPct: number } {
  const sellPrice = computePositionValue(pos);
  const paidPrice = Number(pos.totalDeposited) - Number(pos.totalWithdrawn);
  const pnl = sellPrice - paidPrice;
  const pnlPct = paidPrice > 0 ? (pnl / paidPrice) * 100 : 0;
  return { pnl, pnlPct };
}

/**
 * Compute win probability for a single position based on current market state.
 * Kernel-aware: for continuous markets with kernelWidth>0, a winning bin w
 * pays `Σ_i holdings[i] · K(i,w,W)` (upper bound, scaling_factor=SCALE) — so
 * the user is "profitable if w wins" iff that sum exceeds net cost.
 */
export function computePositionWinProb(pos: UserPosition): number {
  return positionWinProb(pos);
}

function positionWinProb(pos: UserPosition): number {
  const { market } = pos;
  const holdings = pos.holdings.map((h) => Number(h));
  const probabilities = computeProbabilities(
    market.reserves,
    market.totalMinted,
  );
  const netCost = Number(pos.totalDeposited) - Number(pos.totalWithdrawn);
  if (netCost <= 0) return 1;

  const kernelW = market.kernelWidth ?? 0;
  const totals = (market.traderTokenTotals ?? []).map((t) => Number(t));
  const payoutPerWin =
    kernelW > 0
      ? kernelPayoutPerWinEstimated(
          holdings,
          kernelW,
          totals,
          Number(market.totalMinted),
        )
      : kernelPayoutPerWin(holdings, kernelW);

  let winProb = 0;
  for (let i = 0; i < payoutPerWin.length; i++) {
    if (payoutPerWin[i] > netCost) {
      winProb += probabilities[i] ?? 0;
    }
  }
  return Math.min(winProb, 1);
}

// ── Formatting helpers ──

export function formatCompactUsdc(raw: number): string {
  const n = Math.abs(raw) / 10 ** USDC_DECIMALS;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

export function formatRangeValue(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}
