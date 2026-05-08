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
  if (market.resolvedOutcome != null) {
    return holdings[market.resolvedOutcome] ?? 0;
  }
  if (
    market.resolvedValue != null &&
    market.rangeMin != null &&
    market.rangeMax != null
  ) {
    const resolved = Number(market.resolvedValue) / SCALE;
    const rMin = Number(market.rangeMin) / SCALE;
    const rMax = Number(market.rangeMax) / SCALE;
    const binWidth = (rMax - rMin) / market.numOutcomes;
    const winBin = Math.max(
      0,
      Math.min(
        Math.floor((resolved - rMin) / binWidth),
        market.numOutcomes - 1,
      ),
    );
    return holdings[winBin] ?? 0;
  }
  return 0;
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
 * Max Potential Gain: For each undecided position, find the best-case net profit
 * (the bin with maximum holdings minus net cost).
 */
export function computeMaxPotentialGain(
  open: UserPosition[],
  expired: UserPosition[],
): number {
  let total = 0;
  for (const pos of [...open, ...expired]) {
    const holdings = pos.holdings.map((h) => Number(h));
    const maxHolding = Math.max(...holdings, 0);
    const netCost = Math.max(0, Number(pos.totalDeposited) - Number(pos.totalWithdrawn));
    total += Math.max(0, maxHolding - netCost);
  }
  return total;
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
 * Uses current market probabilities weighted by holdings.
 */
export function computeAvgWinProbability(
  open: UserPosition[],
  expired: UserPosition[],
): number {
  const undecided = [...open, ...expired];
  if (undecided.length === 0) return 0;

  let totalProb = 0;
  for (const pos of undecided) {
    const { market } = pos;
    const holdings = pos.holdings.map((h) => Number(h));
    const probabilities = computeProbabilities(
      market.reserves,
      market.totalMinted,
      market.kSquared,
    );
    const netCost = Number(pos.totalDeposited) - Number(pos.totalWithdrawn);
    if (netCost <= 0) {
      totalProb += 1; // Already in profit
      continue;
    }

    // Sum probabilities of bins where holdings > netCost (would be profitable)
    let winProb = 0;
    for (let i = 0; i < holdings.length; i++) {
      if (holdings[i] > netCost) {
        winProb += probabilities[i] ?? 0;
      }
    }
    totalProb += Math.min(winProb, 1);
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
 */
export function computePositionWinProb(pos: UserPosition): number {
  const { market } = pos;
  const holdings = pos.holdings.map((h) => Number(h));
  const probabilities = computeProbabilities(
    market.reserves,
    market.totalMinted,
    market.kSquared,
  );
  const netCost = Number(pos.totalDeposited) - Number(pos.totalWithdrawn);
  if (netCost <= 0) return 1;

  let winProb = 0;
  for (let i = 0; i < holdings.length; i++) {
    if (holdings[i] > netCost) {
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
