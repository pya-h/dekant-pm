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

  it("returns equal probabilities when kSquared is 0", () => {
    expect(computeProbabilities(["50", "50"], "100", "0")).toEqual([0.5, 0.5]);
  });

  it("computes correct binary probabilities (default kSquared = totalMinted²)", () => {
    // reserves = [30, 70], totalMinted = 100 → kSq = 10000
    // p0 = (100-30)² / 10000 = 4900/10000 = 0.49
    // p1 = (100-70)² / 10000 = 900/10000  = 0.09
    const result = computeProbabilities(["30", "70"], "100");
    expect(result[0]).toBeCloseTo(0.49, 5);
    expect(result[1]).toBeCloseTo(0.09, 5);
  });

  it("uses explicit kSquared when provided", () => {
    // kSquared = 20000 instead of default 10000
    // p0 = 4900/20000 = 0.245
    const result = computeProbabilities(["30", "70"], "100", "20000");
    expect(result[0]).toBeCloseTo(0.245, 5);
    expect(result[1]).toBeCloseTo(0.045, 5);
  });

  it("handles equal reserves", () => {
    // reserves = [50, 50], totalMinted = 100 → kSq = 10000
    // p0 = p1 = 2500/10000 = 0.25
    const result = computeProbabilities(["50", "50"], "100");
    expect(result[0]).toBeCloseTo(0.25, 5);
    expect(result[1]).toBeCloseTo(0.25, 5);
  });

  it("handles multi-outcome markets", () => {
    // 3 outcomes, all at reserve 66 → x = 34, p = 34²/10000 = 0.1156
    const result = computeProbabilities(["66", "66", "66"], "100");
    expect(result).toHaveLength(3);
    for (const p of result) {
      expect(p).toBeCloseTo(0.1156, 3);
    }
  });

  it("works with large on-chain numbers (string inputs)", () => {
    const reserves = ["600000000000", "400000000000"];
    const totalMinted = "1000000000000";
    const kSquared = "1000000000000000000000000";
    const result = computeProbabilities(reserves, totalMinted, kSquared);
    expect(result[0]).toBeCloseTo(0.16, 5);
    expect(result[1]).toBeCloseTo(0.36, 5);
  });

  it("accepts numeric totalMinted", () => {
    const result = computeProbabilities(["30", "70"], 100);
    expect(result[0]).toBeCloseTo(0.49, 5);
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
