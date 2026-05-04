import {
  MarketState,
  MarketType,
  SCALE,
  USDC_DECIMALS,
  computeProbabilities,
  type UserPosition,
  type Trade,
} from "./types";

// ── Position value computation ──

/**
 * Computes the mark-to-market value of a position.
 * For resolved markets: value = winning tokens.
 * For active markets: value = sum(holdings[i] * probability[i]).
 */
export function computePositionValue(pos: UserPosition): number {
  const { market } = pos;
  const holdings = pos.holdings.map((h) => Number(h));
  const probabilities = computeProbabilities(
    market.reserves,
    market.totalMinted,
    market.kSquared,
  );

  if (market.state === MarketState.Resolved) {
    return computeResolvedValue(holdings, market);
  }

  let value = 0;
  for (let i = 0; i < holdings.length; i++) {
    value += holdings[i] * (probabilities[i] ?? 0);
  }
  return value;
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
 * Portfolio Value: Sum of mark-to-market values of all active (ongoing) positions.
 * Only includes markets that are Active or Paused (not expired/resolved).
 */
export function computePortfolioValue(openPositions: UserPosition[]): number {
  let total = 0;
  for (const pos of openPositions) {
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
 * Max Potential Gain: For each undecided position, find the best-case scenario
 * (the bin with maximum holdings) and sum across all positions.
 */
export function computeMaxPotentialGain(
  open: UserPosition[],
  expired: UserPosition[],
): number {
  let total = 0;
  for (const pos of [...open, ...expired]) {
    const holdings = pos.holdings.map((h) => Number(h));
    const maxHolding = Math.max(...holdings, 0);
    total += maxHolding;
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
 * Compute current value (mark-to-market) for display in position row.
 */
export function computeCurrentValue(pos: UserPosition): number {
  return computePositionValue(pos);
}

/**
 * Compute PnL (profit and loss) for a position.
 */
export function computePnl(pos: UserPosition): { pnl: number; pnlPct: number } {
  const value = computePositionValue(pos);
  const deposited = Number(pos.totalDeposited);
  const withdrawn = Number(pos.totalWithdrawn);
  const pnl = value - deposited + withdrawn;
  const pnlPct = deposited > 0 ? (pnl / deposited) * 100 : 0;
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
