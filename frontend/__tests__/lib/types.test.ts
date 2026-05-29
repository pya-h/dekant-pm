import { describe, it, expect } from "vitest";
import {
  computeProbabilities,
  formatUsdc,
  formatProbability,
  timeUntil,
  MarketState,
  SCALE,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// computeProbabilities
// ---------------------------------------------------------------------------

describe("computeProbabilities", () => {
  it("returns empty array for empty reserves", () => {
    expect(computeProbabilities([], "100")).toEqual([]);
  });

  it("returns equal probabilities when totalMinted is 0", () => {
    expect(computeProbabilities(["100", "100"], 0)).toEqual([0.5, 0.5]);
  });

  it("returns uniform when no outcome carries a position (sumX = 0)", () => {
    // reserves all equal totalMinted → every x_i = 0
    expect(computeProbabilities(["100", "100"], "100")).toEqual([0.5, 0.5]);
  });

  it("computes linear binary probabilities (p_i = x_i / sumX)", () => {
    // reserves = [30, 70], tm = 100 → x = [70, 30], sumX = 100
    const result = computeProbabilities(["30", "70"], "100");
    expect(result[0]).toBeCloseTo(0.7, 5);
    expect(result[1]).toBeCloseTo(0.3, 5);
  });

  it("is exact at equilibrium (x_i proportional to p_i)", () => {
    // x = [60, 40] (reserves = tm - x) → linear display returns exactly 0.6 / 0.4
    const result = computeProbabilities(["40", "60"], "100");
    expect(result[0]).toBeCloseTo(0.6, 5);
    expect(result[1]).toBeCloseTo(0.4, 5);
  });

  it("returns 1/N for equal reserves", () => {
    // reserves = [50, 50], tm = 100 → x = [50, 50] → 0.5 each
    const result = computeProbabilities(["50", "50"], "100");
    expect(result[0]).toBeCloseTo(0.5, 5);
    expect(result[1]).toBeCloseTo(0.5, 5);
  });

  it("handles multi-outcome markets (uniform → 1/N)", () => {
    // 3 outcomes, all at reserve 66 → x = 34 each → p = 1/3
    const result = computeProbabilities(["66", "66", "66"], "100");
    expect(result).toHaveLength(3);
    for (const p of result) {
      expect(p).toBeCloseTo(1 / 3, 5);
    }
  });

  it("produces probabilities that sum to ~1", () => {
    const result = computeProbabilities(["10", "55", "80", "20"], "100");
    const sum = result.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it("works with large on-chain numbers (string inputs)", () => {
    // x = [400B, 600B], sumX = 1000B → p = [0.4, 0.6]
    const reserves = ["600000000000", "400000000000"];
    const totalMinted = "1000000000000";
    const result = computeProbabilities(reserves, totalMinted);
    expect(result[0]).toBeCloseTo(0.4, 5);
    expect(result[1]).toBeCloseTo(0.6, 5);
  });

  it("accepts numeric totalMinted", () => {
    const result = computeProbabilities(["30", "70"], 100);
    expect(result[0]).toBeCloseTo(0.7, 5);
  });
});

// ---------------------------------------------------------------------------
// formatUsdc
// ---------------------------------------------------------------------------

describe("formatUsdc", () => {
  it("formats zero", () => {
    expect(formatUsdc(0)).toBe("$0.00");
  });

  it("formats small amounts (<$1K) with 2 decimals", () => {
    expect(formatUsdc(1_500_000)).toBe("$1.50");
    expect(formatUsdc(500_000)).toBe("$0.50");
    expect(formatUsdc(999_999_999)).toBe("$1000.00");
  });

  it("formats thousands with K suffix", () => {
    expect(formatUsdc(1_000_000_000)).toBe("$1.0K");
    expect(formatUsdc(5_500_000_000)).toBe("$5.5K");
  });

  it("formats millions with M suffix", () => {
    expect(formatUsdc(1_000_000_000_000)).toBe("$1.0M");
    expect(formatUsdc(2_500_000_000_000)).toBe("$2.5M");
  });

  it("accepts string input", () => {
    expect(formatUsdc("500000")).toBe("$0.50");
  });
});

// ---------------------------------------------------------------------------
// formatProbability
// ---------------------------------------------------------------------------

describe("formatProbability", () => {
  it("formats common percentages", () => {
    expect(formatProbability(0)).toBe("0.0%");
    expect(formatProbability(0.5)).toBe("50.0%");
    expect(formatProbability(1)).toBe("100.0%");
  });

  it("formats with 1 decimal place", () => {
    expect(formatProbability(0.123)).toBe("12.3%");
    expect(formatProbability(0.999)).toBe("99.9%");
  });
});

// ---------------------------------------------------------------------------
// timeUntil
// ---------------------------------------------------------------------------

describe("timeUntil", () => {
  it("returns 'Expired' for past dates", () => {
    expect(timeUntil("2020-01-01T00:00:00Z")).toBe("Expired");
  });

  it("returns minutes format for < 1 hour", () => {
    const inMinutes = new Date(Date.now() + 30 * 60_000).toISOString();
    expect(timeUntil(inMinutes)).toMatch(/^\d+m left$/);
  });

  it("returns hours format for < 1 day", () => {
    const inHours = new Date(Date.now() + 5 * 3_600_000).toISOString();
    expect(timeUntil(inHours)).toMatch(/^\d+h left$/);
  });

  it("returns days format for >= 1 day", () => {
    const inDays = new Date(Date.now() + 3 * 86_400_000).toISOString();
    expect(timeUntil(inDays)).toMatch(/^\d+d left$/);
  });

  it("handles boundary: exactly 1 hour → '1h left'", () => {
    const oneHour = new Date(Date.now() + 3_600_000 + 1000).toISOString();
    expect(timeUntil(oneHour)).toBe("1h left");
  });

  it("handles boundary: exactly 1 day → '1d left'", () => {
    const oneDay = new Date(Date.now() + 86_400_000 + 1000).toISOString();
    expect(timeUntil(oneDay)).toBe("1d left");
  });
});
