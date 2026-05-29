import { describe, it, expect } from "vitest";
import {
  computePositionValue,
  computeAmmSellProceeds,
  getPositionRange,
  categorizePositions,
  computePortfolioValue,
  computeActivePositionCount,
  computeWinRate,
  computeTotalAtRisk,
  computeMaxPotentialGain,
  computeMaxPotentialLoss,
  computeOverlappingPositions,
  computeAvgWinProbability,
  computeCurrentValue,
  computePnl,
  computePositionWinProb,
  formatCompactUsdc,
  formatRangeValue,
} from "@/lib/portfolio-utils";
import {
  MarketState,
  MarketType,
  type MarketSummary,
  type UserPosition,
} from "@/lib/types";
import {
  mockBinaryMarket,
  mockContinuousMarket,
  mockResolvedMarket,
  mockUserPosition,
} from "../helpers/mock-data";

// ── Helpers ──

function makePosition(overrides: Partial<UserPosition> = {}): UserPosition {
  return { ...mockUserPosition, ...overrides };
}

function makeMarket(overrides: Partial<MarketSummary> = {}): MarketSummary {
  return { ...mockBinaryMarket, ...overrides };
}

const SCALE = 1_000_000_000;

// ── computeAmmSellProceeds ──

describe("computeAmmSellProceeds", () => {
  it("returns 0 for zero holdings", () => {
    expect(
      computeAmmSellProceeds(["10000000", "5000000"], "25000000", [0, 0]),
    ).toBe(0);
  });

  it("computes net sell proceeds after fees for single outcome", () => {
    // Sell 10M tokens of outcome 0 from market [10M, 5M] / 25M
    const proceeds = computeAmmSellProceeds(
      ["10000000", "5000000"],
      "25000000",
      [10000000, 0],
    );
    // gross = floor(25M - sqrt(5M² + 20M²)) = 4384471
    // fee = floor(4384471 * 30 / 10000) = 13153
    // net = 4371318
    expect(proceeds).toBe(4371318);
  });

  it("computes sequential sell proceeds for multiple outcomes", () => {
    const proceeds = computeAmmSellProceeds(
      ["10000000", "5000000"],
      "25000000",
      [10000000, 5000000],
    );
    // Two sequential sells, pool state updates between them
    expect(proceeds).toBe(9161046);
  });

  it("skips outcomes where holdings exceed circulating supply", () => {
    // x[0] = 25M - 10M = 15M, holdings[0] = 20M > 15M → skipped
    const proceeds = computeAmmSellProceeds(
      ["10000000", "5000000"],
      "25000000",
      [20000000, 0],
    );
    expect(proceeds).toBe(0);
  });

  it("applies custom fee rate", () => {
    const noFee = computeAmmSellProceeds(
      ["10000000", "5000000"],
      "25000000",
      [10000000, 0],
      0,
    );
    const withFee = computeAmmSellProceeds(
      ["10000000", "5000000"],
      "25000000",
      [10000000, 0],
      30,
    );
    expect(noFee).toBeGreaterThan(withFee);
  });
});

// ── computePositionValue ──

describe("computePositionValue", () => {
  it("computes AMM sell proceeds for active binary position", () => {
    const pos = makePosition();
    const value = computePositionValue(pos);
    // Sell proceeds for holdings=[10M,5M] in market reserves=[10M,5M]/25M
    expect(value).toBe(9161046);
  });

  it("returns winning token value for resolved market with resolvedOutcome", () => {
    const pos = makePosition({
      market: mockResolvedMarket,
      holdings: ["10000000", "5000000"],
    });
    // resolvedOutcome = 0, so value = holdings[0] = 10000000
    expect(computePositionValue(pos)).toBe(10000000);
  });

  it("returns winning bin value for resolved continuous market with resolvedValue", () => {
    const market = makeMarket({
      marketType: MarketType.Continuous,
      state: MarketState.Resolved,
      numOutcomes: 10,
      rangeMin: "0",
      rangeMax: String(100 * SCALE),
      resolvedOutcome: null,
      resolvedValue: String(35 * SCALE), // bin 3 (35 is in [30,40))
      resolvedAt: new Date().toISOString(),
    });
    const holdings = ["0", "0", "0", "500", "0", "0", "0", "0", "0", "0"];
    const pos = makePosition({ market, holdings });
    expect(computePositionValue(pos)).toBe(500);
  });

  it("returns 0 for resolved market with no resolved info", () => {
    const market = makeMarket({
      state: MarketState.Resolved,
      resolvedOutcome: null,
      resolvedValue: null,
    });
    const pos = makePosition({ market });
    expect(computePositionValue(pos)).toBe(0);
  });
});

// ── getPositionRange ──

describe("getPositionRange", () => {
  it("returns null for non-continuous market", () => {
    const pos = makePosition({ market: mockBinaryMarket });
    expect(getPositionRange(pos)).toBeNull();
  });

  it("returns null when all holdings are zero", () => {
    const market = makeMarket({
      ...mockContinuousMarket,
    });
    const pos = makePosition({
      market,
      holdings: Array(10).fill("0"),
    });
    expect(getPositionRange(pos)).toBeNull();
  });

  it("returns correct range for non-zero holdings in continuous market", () => {
    // range [0, 100], 10 bins → bin width = 10
    // holdings non-zero at bins 2,3,4 → range [20, 50]
    const market = makeMarket({
      ...mockContinuousMarket,
      rangeMin: "0",
      rangeMax: String(100 * SCALE),
      numOutcomes: 10,
    });
    const holdings = ["0", "0", "5", "10", "3", "0", "0", "0", "0", "0"];
    const pos = makePosition({ market, holdings });
    const range = getPositionRange(pos);
    expect(range).not.toBeNull();
    expect(range!.min).toBeCloseTo(20, 1);
    expect(range!.max).toBeCloseTo(50, 1);
  });

  it("returns full range when all bins have holdings", () => {
    const market = makeMarket({
      ...mockContinuousMarket,
      rangeMin: "0",
      rangeMax: String(100 * SCALE),
      numOutcomes: 10,
    });
    const holdings = Array(10).fill("1");
    const pos = makePosition({ market, holdings });
    const range = getPositionRange(pos);
    expect(range!.min).toBeCloseTo(0, 1);
    expect(range!.max).toBeCloseTo(100, 1);
  });
});

// ── categorizePositions ──

describe("categorizePositions", () => {
  it("returns empty categories for empty input", () => {
    const result = categorizePositions([]);
    expect(result.all).toHaveLength(0);
    expect(result.open).toHaveLength(0);
    expect(result.settled).toHaveLength(0);
    expect(result.expired).toHaveLength(0);
  });

  it("filters out positions with all-zero holdings", () => {
    const pos = makePosition({ holdings: ["0", "0"] });
    const result = categorizePositions([pos]);
    expect(result.all).toHaveLength(0);
  });

  it("categorizes resolved positions as settled", () => {
    const pos = makePosition({
      market: mockResolvedMarket,
      holdings: ["10", "0"],
    });
    const result = categorizePositions([pos]);
    expect(result.settled).toHaveLength(1);
    expect(result.open).toHaveLength(0);
    expect(result.expired).toHaveLength(0);
  });

  it("categorizes active markets with future deadline as open", () => {
    const market = makeMarket({
      state: MarketState.Active,
      deadline: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const pos = makePosition({ market, holdings: ["10", "0"] });
    const result = categorizePositions([pos]);
    expect(result.open).toHaveLength(1);
    expect(result.expired).toHaveLength(0);
  });

  it("categorizes active markets with past deadline as expired", () => {
    const market = makeMarket({
      state: MarketState.Active,
      deadline: new Date(Date.now() - 86_400_000).toISOString(),
    });
    const pos = makePosition({ market, holdings: ["10", "0"] });
    const result = categorizePositions([pos]);
    expect(result.expired).toHaveLength(1);
    expect(result.open).toHaveLength(0);
  });
});

// ── computePortfolioValue ──

describe("computePortfolioValue", () => {
  it("returns 0 for empty list", () => {
    expect(computePortfolioValue([])).toBe(0);
  });

  it("sums sell proceeds of positions", () => {
    const pos1 = makePosition({ holdings: ["10000000", "5000000"] });
    const pos2 = makePosition({
      id: "pos-2",
      holdings: ["10000000", "5000000"],
    });
    const value = computePortfolioValue([pos1, pos2]);
    // Each = 9161046, total = 18322092
    expect(value).toBe(18322092);
  });
});

// ── computeActivePositionCount ──

describe("computeActivePositionCount", () => {
  it("returns sum of open and expired positions", () => {
    const open = [makePosition(), makePosition({ id: "2" })];
    const expired = [makePosition({ id: "3" })];
    expect(computeActivePositionCount(open, expired)).toBe(3);
  });

  it("returns 0 when both are empty", () => {
    expect(computeActivePositionCount([], [])).toBe(0);
  });
});

// ── computeWinRate ──

describe("computeWinRate", () => {
  it("returns 0 for empty list", () => {
    expect(computeWinRate([])).toBe(0);
  });

  it("returns 1.0 when all positions won", () => {
    const pos = makePosition({
      market: mockResolvedMarket,
      holdings: ["20000000", "0"],
      totalDeposited: "12000000",
      totalWithdrawn: "0",
    });
    // payout=20000000 > 12000000 → win
    expect(computeWinRate([pos])).toBe(1);
  });

  it("returns 0 when all positions lost", () => {
    const pos = makePosition({
      market: mockResolvedMarket,
      holdings: ["5000000", "0"],
      totalDeposited: "12000000",
      totalWithdrawn: "0",
    });
    // payout=5000000 < 12000000 → loss
    expect(computeWinRate([pos])).toBe(0);
  });

  it("returns correct ratio for mixed results", () => {
    const winner = makePosition({
      id: "w1",
      market: mockResolvedMarket,
      holdings: ["20000000", "0"],
      totalDeposited: "10000000",
      totalWithdrawn: "0",
    });
    const loser = makePosition({
      id: "l1",
      market: mockResolvedMarket,
      holdings: ["5000000", "0"],
      totalDeposited: "10000000",
      totalWithdrawn: "0",
    });
    expect(computeWinRate([winner, loser])).toBe(0.5);
  });
});

// ── computeTotalAtRisk ──

describe("computeTotalAtRisk", () => {
  it("returns 0 for empty lists", () => {
    expect(computeTotalAtRisk([], [])).toBe(0);
  });

  it("sums net costs (deposited - withdrawn) clamped to 0", () => {
    const pos1 = makePosition({ totalDeposited: "10000000", totalWithdrawn: "3000000" });
    const pos2 = makePosition({
      id: "2",
      totalDeposited: "5000000",
      totalWithdrawn: "8000000",
    });
    // pos1 net = 7000000, pos2 net = -3000000 → clamped to 0
    expect(computeTotalAtRisk([pos1], [pos2])).toBe(7000000);
  });
});

// ── computeMaxPotentialGain ──

describe("computeMaxPotentialGain", () => {
  it("returns 0 for empty lists", () => {
    expect(computeMaxPotentialGain([], [])).toBe(0);
  });

  it("sums net gain (max payout minus net cost) per position", () => {
    // pos1: deposited=12000000, withdrawn=0 → netCost=12000000
    //   max holding=10000000 < 12000000 → gain=0 (would lose even in best case)
    const pos1 = makePosition({ holdings: ["10000000", "5000000"] });
    // pos2: deposited=12000000, withdrawn=0 → netCost=12000000
    //   max holding=8000000 < 12000000 → gain=0
    const pos2 = makePosition({ id: "2", holdings: ["3000000", "8000000"] });
    expect(computeMaxPotentialGain([pos1], [pos2])).toBe(0);
  });

  it("computes positive net gain when max payout exceeds net cost", () => {
    // deposited=5000000, withdrawn=0 → netCost=5000000
    // max holding=10000000 → gain=10000000-5000000=5000000
    const pos1 = makePosition({
      holdings: ["10000000", "5000000"],
      totalDeposited: "5000000",
      totalWithdrawn: "0",
    });
    // deposited=3000000, withdrawn=1000000 → netCost=2000000
    // max holding=8000000 → gain=8000000-2000000=6000000
    const pos2 = makePosition({
      id: "2",
      holdings: ["3000000", "8000000"],
      totalDeposited: "3000000",
      totalWithdrawn: "1000000",
    });
    // total = 5000000 + 6000000 = 11000000
    expect(computeMaxPotentialGain([pos1], [pos2])).toBe(11000000);
  });
});

// ── computeMaxPotentialLoss ──

describe("computeMaxPotentialLoss", () => {
  it("equals total at risk", () => {
    const pos = makePosition({ totalDeposited: "10000000", totalWithdrawn: "2000000" });
    expect(computeMaxPotentialLoss([pos], [])).toBe(8000000);
  });
});

// ── computeOverlappingPositions ──

describe("computeOverlappingPositions", () => {
  it("returns 0 for empty or single position", () => {
    expect(computeOverlappingPositions([])).toBe(0);
    expect(computeOverlappingPositions([makePosition()])).toBe(0);
  });

  it("counts same-market pairs as overlapping", () => {
    const pos1 = makePosition({ id: "1", marketId: "1" });
    const pos2 = makePosition({ id: "2", marketId: "1" });
    expect(computeOverlappingPositions([pos1, pos2])).toBe(1);
  });

  it("does not count different-market binary positions as overlapping", () => {
    const pos1 = makePosition({
      id: "1",
      marketId: "1",
      market: makeMarket({ id: "1" }),
    });
    const pos2 = makePosition({
      id: "2",
      marketId: "2",
      market: makeMarket({ id: "2" }),
    });
    expect(computeOverlappingPositions([pos1, pos2])).toBe(0);
  });

  it("counts overlapping continuous market ranges", () => {
    const baseMarket = {
      ...mockContinuousMarket,
      numOutcomes: 10,
      rangeMin: "0",
      rangeMax: String(100 * SCALE),
    };
    // pos1: holdings in bins 2-4 → range [20,50]
    const pos1 = makePosition({
      id: "1",
      marketId: "1",
      market: makeMarket({ ...baseMarket, id: "1" }),
      holdings: ["0", "0", "5", "10", "3", "0", "0", "0", "0", "0"],
    });
    // pos2: holdings in bins 3-5 → range [30,60] — overlaps with [20,50]
    const pos2 = makePosition({
      id: "2",
      marketId: "2",
      market: makeMarket({ ...baseMarket, id: "2" }),
      holdings: ["0", "0", "0", "5", "10", "3", "0", "0", "0", "0"],
    });
    expect(computeOverlappingPositions([pos1, pos2])).toBe(1);
  });

  it("does not count non-overlapping continuous ranges", () => {
    const baseMarket = {
      ...mockContinuousMarket,
      numOutcomes: 10,
      rangeMin: "0",
      rangeMax: String(100 * SCALE),
    };
    // pos1: bins 0-1 → range [0,20]
    const pos1 = makePosition({
      id: "1",
      marketId: "1",
      market: makeMarket({ ...baseMarket, id: "1" }),
      holdings: ["5", "10", "0", "0", "0", "0", "0", "0", "0", "0"],
    });
    // pos2: bins 8-9 → range [80,100]
    const pos2 = makePosition({
      id: "2",
      marketId: "2",
      market: makeMarket({ ...baseMarket, id: "2" }),
      holdings: ["0", "0", "0", "0", "0", "0", "0", "0", "5", "10"],
    });
    expect(computeOverlappingPositions([pos1, pos2])).toBe(0);
  });
});

// ── computeAvgWinProbability ──

describe("computeAvgWinProbability", () => {
  it("returns 0 for empty lists", () => {
    expect(computeAvgWinProbability([], [])).toBe(0);
  });

  it("returns 1 for position with netCost <= 0", () => {
    const pos = makePosition({
      totalDeposited: "5000000",
      totalWithdrawn: "6000000",
    });
    expect(computeAvgWinProbability([pos], [])).toBe(1);
  });

  it("computes probability from bins where holdings > netCost", () => {
    // netCost = 12000000 - 0 = 12000000
    // holdings = [10000000, 5000000] → neither > 12000000
    // So win probability = 0
    const pos = makePosition();
    expect(computeAvgWinProbability([pos], [])).toBe(0);
  });

  it("computes non-zero probability when some bins exceed net cost", () => {
    // netCost = 5000000
    // holdings = [10000000, 5000000] → bin 0 (10000000 > 5000000) wins
    // linear p[0] = x[0]/sumX = 15M/35M ≈ 0.4286 (x = [15M, 20M])
    const pos = makePosition({
      totalDeposited: "5000000",
      totalWithdrawn: "0",
    });
    const result = computeAvgWinProbability([pos], []);
    expect(result).toBeCloseTo(0.4286, 3);
  });
});

// ── computePnl ──

describe("computePnl", () => {
  it("computes pnl and pnlPct using sell proceeds and paid price", () => {
    const pos = makePosition({
      totalDeposited: "12000000",
      totalWithdrawn: "2000000",
    });
    const { pnl, pnlPct } = computePnl(pos);
    // sellPrice = 9161046, paidPrice = 12M - 2M = 10M
    // pnl = 9161046 - 10000000 = -838954
    expect(pnl).toBe(-838954);
    // pnlPct = -838954 / 10000000 * 100 = -8.38954
    expect(pnlPct).toBeCloseTo(-8.39, 1);
  });

  it("returns 0 pnlPct when paidPrice is 0", () => {
    const pos = makePosition({
      totalDeposited: "0",
      totalWithdrawn: "0",
      holdings: ["0", "0"],
    });
    const { pnlPct } = computePnl(pos);
    expect(pnlPct).toBe(0);
  });

  it("returns 0 pnlPct when withdrawn exceeds deposited", () => {
    const pos = makePosition({
      totalDeposited: "5000000",
      totalWithdrawn: "6000000",
    });
    const { pnlPct } = computePnl(pos);
    // paidPrice = -1M ≤ 0, so pnlPct = 0
    expect(pnlPct).toBe(0);
  });
});

// ── computePositionWinProb ──

describe("computePositionWinProb", () => {
  it("returns 1 when net cost is 0 or negative", () => {
    const pos = makePosition({
      totalDeposited: "5000000",
      totalWithdrawn: "6000000",
    });
    expect(computePositionWinProb(pos)).toBe(1);
  });

  it("returns probability of profitable bins", () => {
    // netCost = 5000000
    // holdings[0] = 10000000 > 5000000 → includes linear prob[0] = 15M/35M ≈ 0.4286
    // holdings[1] = 5000000 not > 5000000 → excluded
    const pos = makePosition({
      totalDeposited: "5000000",
      totalWithdrawn: "0",
    });
    expect(computePositionWinProb(pos)).toBeCloseTo(0.4286, 3);
  });
});

// ── computeCurrentValue ──

describe("computeCurrentValue", () => {
  it("delegates to computePositionValue", () => {
    const pos = makePosition();
    expect(computeCurrentValue(pos)).toBe(computePositionValue(pos));
  });
});

// ── formatCompactUsdc ──

describe("formatCompactUsdc", () => {
  it("formats small amounts with 2 decimals", () => {
    expect(formatCompactUsdc(1_500_000)).toBe("$1.50");
    expect(formatCompactUsdc(500_000)).toBe("$0.50");
  });

  it("formats thousands with K suffix", () => {
    // 5_000_000_000 / 10^6 = 5000 → >= 1000 → $5.00K
    expect(formatCompactUsdc(5_000_000_000)).toBe("$5.00K");
    expect(formatCompactUsdc(1_500_000_000)).toBe("$1.50K");
  });

  it("formats millions with M suffix", () => {
    expect(formatCompactUsdc(1_500_000_000_000)).toBe("$1.50M");
  });

  it("handles negative values (uses absolute)", () => {
    expect(formatCompactUsdc(-1_500_000)).toBe("$1.50");
  });

  it("formats zero", () => {
    expect(formatCompactUsdc(0)).toBe("$0.00");
  });
});

// ── formatRangeValue ──

describe("formatRangeValue", () => {
  it("formats values < 1000 with $ and no decimals", () => {
    expect(formatRangeValue(42)).toBe("$42");
    expect(formatRangeValue(999)).toBe("$999");
  });

  it("formats thousands with K suffix", () => {
    expect(formatRangeValue(5000)).toBe("$5K");
    expect(formatRangeValue(65000)).toBe("$65K");
  });

  it("formats millions with M suffix", () => {
    expect(formatRangeValue(1_500_000)).toBe("$1.5M");
    expect(formatRangeValue(10_000_000)).toBe("$10.0M");
  });

  it("handles negative values", () => {
    expect(formatRangeValue(-5000)).toBe("$-5K");
  });
});
