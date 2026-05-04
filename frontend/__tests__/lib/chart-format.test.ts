import { describe, it, expect } from "vitest";
import { formatChartValue, formatPct, formatPrice } from "@/lib/chart-format";

// ---------------------------------------------------------------------------
// formatChartValue
// ---------------------------------------------------------------------------

describe("formatChartValue", () => {
  it("formats millions with M suffix", () => {
    expect(formatChartValue(1_000_000)).toBe("1.0M");
    expect(formatChartValue(2_500_000)).toBe("2.5M");
    expect(formatChartValue(10_000_000)).toBe("10.0M");
  });

  it("formats negative millions", () => {
    expect(formatChartValue(-1_000_000)).toBe("-1.0M");
    expect(formatChartValue(-5_500_000)).toBe("-5.5M");
  });

  it("formats thousands with K suffix", () => {
    expect(formatChartValue(1_000)).toBe("1.0K");
    expect(formatChartValue(5_500)).toBe("5.5K");
    expect(formatChartValue(999_999)).toBe("1000.0K");
  });

  it("formats negative thousands", () => {
    expect(formatChartValue(-1_000)).toBe("-1.0K");
    expect(formatChartValue(-25_000)).toBe("-25.0K");
  });

  it("returns plain integer string for integers < 1000", () => {
    expect(formatChartValue(0)).toBe("0");
    expect(formatChartValue(1)).toBe("1");
    expect(formatChartValue(42)).toBe("42");
    expect(formatChartValue(999)).toBe("999");
  });

  it("formats decimals with 2 decimal places", () => {
    expect(formatChartValue(0.5)).toBe("0.50");
    expect(formatChartValue(3.14159)).toBe("3.14");
    expect(formatChartValue(99.999)).toBe("100.00");
  });

  it("handles zero correctly", () => {
    expect(formatChartValue(0)).toBe("0");
  });

  it("handles boundary between K and plain number", () => {
    expect(formatChartValue(999)).toBe("999");
    expect(formatChartValue(1000)).toBe("1.0K");
  });

  it("handles boundary between M and K", () => {
    expect(formatChartValue(999_999)).toBe("1000.0K");
    expect(formatChartValue(1_000_000)).toBe("1.0M");
  });
});

// ---------------------------------------------------------------------------
// formatPct
// ---------------------------------------------------------------------------

describe("formatPct", () => {
  it("rounds to integer for percentages >= 10%", () => {
    expect(formatPct(0.10)).toBe("10%");
    expect(formatPct(0.25)).toBe("25%");
    expect(formatPct(0.50)).toBe("50%");
    expect(formatPct(1.0)).toBe("100%");
  });

  it("formats with 1 decimal for percentages 1% - 10%", () => {
    expect(formatPct(0.01)).toBe("1.0%");
    expect(formatPct(0.05)).toBe("5.0%");
    expect(formatPct(0.099)).toBe("9.9%");
  });

  it("formats with 2 decimals for percentages < 1%", () => {
    expect(formatPct(0.001)).toBe("0.10%");
    expect(formatPct(0.005)).toBe("0.50%");
    expect(formatPct(0.0001)).toBe("0.01%");
  });

  it("handles zero", () => {
    expect(formatPct(0)).toBe("0.00%");
  });

  it("handles very small values", () => {
    expect(formatPct(0.00001)).toBe("0.00%");
  });
});

// ---------------------------------------------------------------------------
// formatPrice
// ---------------------------------------------------------------------------

describe("formatPrice", () => {
  it("formats prices >= $1 with 2 decimal places", () => {
    expect(formatPrice(1.0)).toBe("$1.00");
    expect(formatPrice(5.5)).toBe("$5.50");
    expect(formatPrice(100.123)).toBe("$100.12");
  });

  it("formats prices $0.01 - $1 with 3 decimal places", () => {
    expect(formatPrice(0.01)).toBe("$0.010");
    expect(formatPrice(0.5)).toBe("$0.500");
    expect(formatPrice(0.999)).toBe("$0.999");
  });

  it("formats prices < $0.01 with 4 decimal places", () => {
    expect(formatPrice(0.009)).toBe("$0.0090");
    expect(formatPrice(0.001)).toBe("$0.0010");
    expect(formatPrice(0.0001)).toBe("$0.0001");
  });

  it("handles zero", () => {
    expect(formatPrice(0)).toBe("$0.0000");
  });

  it("handles boundary at $1", () => {
    expect(formatPrice(0.999)).toBe("$0.999");
    expect(formatPrice(1.0)).toBe("$1.00");
  });

  it("handles boundary at $0.01", () => {
    expect(formatPrice(0.0099)).toBe("$0.0099");
    expect(formatPrice(0.01)).toBe("$0.010");
  });
});
