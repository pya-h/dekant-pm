import { describe, it, expect } from "vitest";
import {
  computePositionValue,
  computeAmmSellProceeds,
  computeKernelPayout,
  computeKernelPeakPayout,
  kernelPayoutPerWin,
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

  it("uses the kernel payout for resolved continuous markets with kernelWidth > 0", () => {
    // win=5, w=2, sf=SCALE (no scaling):
    //   K(4,5,2) = K(6,5,2) = floor(SCALE * 2/3) = 666_666_666
    //   K(5,5,2) = SCALE
    //   raw = floor(100 * 666_666_666 / SCALE) + 1000 + floor(100 * 666_666_666 / SCALE)
    //       = 66 + 1000 + 66 = 1132
    //   payout = floor(1132 * SCALE / SCALE) = 1132
    const market = makeMarket({
      marketType: MarketType.Continuous,
      state: MarketState.Resolved,
      numOutcomes: 10,
      resolvedOutcome: 5,
      resolvedValue: null,
      kernelWidth: 2,
      scalingFactor: String(SCALE),
    });
    const holdings = ["0", "0", "0", "0", "100", "1000", "100", "0", "0", "0"];
    const pos = makePosition({ market, holdings });
    expect(computePositionValue(pos)).toBe(1132);
  });
});

// ── computeKernelPayout ──

describe("computeKernelPayout", () => {
  it("returns holdings[win] when kernel_width=0 (pure WTA semantics)", () => {
    // kernel_width=0 makes K(i,win,0) = SCALE iff i==win, else 0
    expect(computeKernelPayout([0, 0, 500, 0], 2, 0, String(SCALE))).toBe(500);
  });

  it("dilutes payout proportionally when scalingFactor < SCALE", () => {
    // win=5, w=2: raw = 333 + 2000 + 333 = 2666 (per kernel arithmetic)
    // sf = SCALE/2 → payout = floor(2666 * 0.5) = 1333
    const holdings = [0, 0, 0, 0, 500, 2000, 500, 0, 0, 0];
    const sf = String(SCALE / 2);
    expect(computeKernelPayout(holdings, 5, 2, sf)).toBe(1333);
  });

  it("truncates kernel support at the left boundary", () => {
    // win=0, w=2 → K(0)=SCALE, K(1)=2/3·SCALE, K(2)=1/3·SCALE; bins -1,-2 are absent
    // holdings = [0, 100, 100] → raw = 0 + 66 + 33 = 99; payout = 99 at sf=SCALE
    expect(computeKernelPayout([0, 100, 100], 0, 2, String(SCALE))).toBe(99);
  });

  it("returns 0 when no holdings fall inside the kernel support", () => {
    // win=10, w=2, support = bins {8,9,10,11,12}; holdings live at bin 0
    const holdings = [1000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(computeKernelPayout(holdings, 10, 2, String(SCALE))).toBe(0);
  });
});

// ── kernelPayoutPerWin / computeKernelPeakPayout ──

describe("kernelPayoutPerWin", () => {
  it("returns identity holdings when kernelWidth=0 (WTA fallback)", () => {
    const holdings = [10, 20, 30, 5];
    expect(kernelPayoutPerWin(holdings, 0)).toEqual(holdings);
  });

  it("computes Σ_i holdings[i] · K(i, w, W) per winning bin", () => {
    // W=2 → K(i, w, 2): denom=3, weights at distance 0/1/2 are 3/3, 2/3, 1/3
    // (BigInt floor of SCALE * (3-d)/3 = SCALE, ~0.667·SCALE, ~0.333·SCALE).
    // holdings = [0, 0, 100, 0, 0] at bin 2.
    // For winner w=2: payout = floor(100·SCALE/SCALE) = 100.
    // For winner w=3: payout = floor(100·(2/3)·SCALE/SCALE) = 66 (BigInt floor).
    // For winner w=4: payout = floor(100·(1/3)·SCALE/SCALE) = 33.
    // For winner w=0 (distance 2): payout = floor(100·(1/3)) = 33.
    // For winner w=1 (distance 1): payout = floor(100·(2/3)) = 66.
    const perWin = kernelPayoutPerWin([0, 0, 100, 0, 0], 2);
    expect(perWin).toEqual([33, 66, 100, 66, 33]);
  });

  it("sums neighbour contributions for a Gaussian-shaped distribution buy", () => {
    // Triangular-style buy [10, 30, 60, 30, 10] at bin 2 with W=2.
    // For winner w=2 (center): all bins contribute fully or partially.
    //   K=[1/3, 2/3, 1, 2/3, 1/3] → terms: 10·1/3 + 30·2/3 + 60·1 + 30·2/3 + 10·1/3
    //   BigInt floors per term: floor(10·333333333/1e9)=3, floor(30·666666666/1e9)=19,
    //     floor(60·1e9/1e9)=60, floor(30·666666666/1e9)=19, floor(10·333333333/1e9)=3
    //   raw = 3 + 19 + 60 + 19 + 3 = 104.
    const perWin = kernelPayoutPerWin([10, 30, 60, 30, 10], 2);
    expect(perWin[2]).toBe(104);
    // Edge bin (w=0): K=[1, 2/3, 1/3, 0, 0] → 10·1 + 30·2/3 + 60·1/3 = 10 + 19 + 19 = 48
    expect(perWin[0]).toBe(48);
    // Symmetry: w=2 should be the peak (any other w must be ≤).
    expect(Math.max(...perWin)).toBe(perWin[2]);
  });
});

describe("computeKernelPeakPayout", () => {
  it("matches max(holdings) when kernelWidth=0 (WTA)", () => {
    expect(computeKernelPeakPayout([10, 50, 30], 0)).toBe(50);
  });

  it("returns 0 for empty holdings", () => {
    expect(computeKernelPeakPayout([], 0)).toBe(0);
    expect(computeKernelPeakPayout([], 3)).toBe(0);
  });

  it("greatly exceeds max(holdings) for a Gaussian-shaped buy when W>0", () => {
    // Same fixture as above. max(holdings) = 60, kernel-aware peak = 104.
    const holdings = [10, 30, 60, 30, 10];
    expect(computeKernelPeakPayout(holdings, 2)).toBeGreaterThan(
      Math.max(...holdings),
    );
    expect(computeKernelPeakPayout(holdings, 2)).toBe(104);
  });

  it("equals max(holdings) when all holdings are in a single bin (kernel adds nothing)", () => {
    // Single concentrated holding — neighbouring bins contribute 0.
    // For winner w == position, payout = holdings[w]. For any other w, payout < holdings[w].
    const holdings = [0, 0, 100, 0, 0];
    expect(computeKernelPeakPayout(holdings, 2)).toBe(100);
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

  it("uses kernel-aware peak (not max(holdings)) for continuous markets with kernelWidth>0", () => {
    // Same Gaussian fixture: max(holdings)=60, kernel peak=104.
    // netCost=60 → WTA would give 0 net gain; kernel-aware gives 104-60=44.
    const market = makeMarket({
      ...mockContinuousMarket,
      numOutcomes: 5,
      kernelWidth: 2,
      reserves: ["100", "100", "100", "100", "100"],
      totalMinted: "100",
    });
    const pos = makePosition({
      market,
      holdings: ["10", "30", "60", "30", "10"],
      totalDeposited: "60",
      totalWithdrawn: "0",
    });
    expect(computeMaxPotentialGain([pos], [])).toBe(44);
  });

  it("falls back to WTA peak for continuous markets with kernelWidth=0", () => {
    // Same fixture but no kernel — peak = max(holdings) = 60, netCost=60 → 0 gain.
    const market = makeMarket({
      ...mockContinuousMarket,
      numOutcomes: 5,
      kernelWidth: 0,
    });
    const pos = makePosition({
      market,
      holdings: ["10", "30", "60", "30", "10"],
      totalDeposited: "60",
      totalWithdrawn: "0",
    });
    expect(computeMaxPotentialGain([pos], [])).toBe(0);
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

  it("counts kernel-neighbour bins as winning for continuous markets with kernelWidth>0", () => {
    // 5-bin continuous, kernel W=2, holdings concentrated at bin 2.
    // netCost = 40, kernel payout if bin 1 (neighbour) wins = floor(100·2/3) = 66 > 40 → counts.
    // Without kernel-awareness, bin 1 would NOT count (single-bin holdings[1]=0).
    // Symmetric: bins 0,1,2,3,4 all yield kernel payouts {33, 66, 100, 66, 33}.
    // Winning bins where payout > 40: {1, 2, 3} → sum p_{1}+p_{2}+p_{3}.
    const market = makeMarket({
      ...mockContinuousMarket,
      numOutcomes: 5,
      kernelWidth: 2,
      // Equal reserves → uniform probability 0.2 each.
      reserves: ["100", "100", "100", "100", "100"],
      totalMinted: "100",
    });
    const pos = makePosition({
      market,
      holdings: ["0", "0", "100", "0", "0"],
      totalDeposited: "40",
      totalWithdrawn: "0",
    });
    // uniform reserves → x_i = 0 each, computeProbabilities falls back to 1/n = 0.2
    // Three winning bins {1, 2, 3} → totalProb = 0.6
    expect(computeAvgWinProbability([pos], [])).toBeCloseTo(0.6, 5);
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

  it("includes kernel-neighbour bins for continuous markets with kernelWidth>0", () => {
    // Concentrated holding at bin 2 (100), W=2, netCost=40.
    // payoutPerWin = [33, 66, 100, 66, 33]; > 40 at bins {1,2,3}.
    // Uniform reserves → each p_i = 0.2 → totalWin = 0.6.
    const market = makeMarket({
      ...mockContinuousMarket,
      numOutcomes: 5,
      kernelWidth: 2,
      reserves: ["100", "100", "100", "100", "100"],
      totalMinted: "100",
    });
    const pos = makePosition({
      market,
      holdings: ["0", "0", "100", "0", "0"],
      totalDeposited: "40",
      totalWithdrawn: "0",
    });
    expect(computePositionWinProb(pos)).toBeCloseTo(0.6, 5);
  });

  it("matches WTA behaviour when kernelWidth=0 on a continuous market", () => {
    // Same fixture, kernelWidth=0 → kernelPayoutPerWin returns holdings unchanged.
    // Only bin 2 has holdings>0 and 100 > 40, so winProb = p_2 = 0.2.
    const market = makeMarket({
      ...mockContinuousMarket,
      numOutcomes: 5,
      kernelWidth: 0,
      reserves: ["100", "100", "100", "100", "100"],
      totalMinted: "100",
    });
    const pos = makePosition({
      market,
      holdings: ["0", "0", "100", "0", "0"],
      totalDeposited: "40",
      totalWithdrawn: "0",
    });
    expect(computePositionWinProb(pos)).toBeCloseTo(0.2, 5);
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
