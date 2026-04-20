import { describe, it, expect } from "vitest";
import {
  computeBinWeights,
  sliderToSigma,
  sigmaToSlider,
} from "@/lib/normal";

// ---------------------------------------------------------------------------
// computeBinWeights
// ---------------------------------------------------------------------------

describe("computeBinWeights", () => {
  it("returns zeros for sigma <= 0", () => {
    expect(computeBinWeights(0, 100, 10, 50, 0)).toEqual(Array(10).fill(0));
    expect(computeBinWeights(0, 100, 10, 50, -5)).toEqual(Array(10).fill(0));
  });

  it("returns zeros for inverted range", () => {
    expect(computeBinWeights(100, 0, 10, 50, 10)).toEqual(Array(10).fill(0));
  });

  it("returns zeros for numBins <= 0", () => {
    expect(computeBinWeights(0, 100, 0, 50, 10)).toEqual([]);
  });

  it("normalised weights sum to ~1", () => {
    const weights = computeBinWeights(0, 100, 10, 50, 15);
    const sum = weights.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it("peaks at the bin containing mu", () => {
    // mu = 25, range [0,100], 10 bins → bin 2 center = 25
    const weights = computeBinWeights(0, 100, 10, 25, 10);
    const maxIdx = weights.indexOf(Math.max(...weights));
    expect(maxIdx).toBe(2);
  });

  it("distributes symmetrically around mu when mu is bin center", () => {
    // mu = 50 is between bin 4 (center 45) and bin 5 (center 55)
    // Both should have equal weight
    const weights = computeBinWeights(0, 100, 10, 50, 15);
    expect(weights[4]).toBeCloseTo(weights[5], 10);
  });

  it("returns all zeros when mu is far outside range", () => {
    // mu=1000, sigma=1 → all z > Z_CUTOFF (5)
    expect(computeBinWeights(0, 100, 10, 1000, 1)).toEqual(Array(10).fill(0));
  });

  it("handles single bin", () => {
    expect(computeBinWeights(0, 100, 1, 50, 25)).toEqual([1]);
  });

  it("narrows distribution for small sigma", () => {
    const narrow = computeBinWeights(0, 100, 20, 50, 2);
    const wide = computeBinWeights(0, 100, 20, 50, 30);
    // Narrow distribution peak should be taller than wide distribution peak
    expect(Math.max(...narrow)).toBeGreaterThan(Math.max(...wide));
  });
});

// ---------------------------------------------------------------------------
// sliderToSigma / sigmaToSlider
// ---------------------------------------------------------------------------

describe("sliderToSigma", () => {
  const rangeWidth = 100;

  it("returns small sigma for slider = 0 (very sure)", () => {
    const sigma = sliderToSigma(0, rangeWidth);
    expect(sigma).toBeCloseTo(1, 0); // 1% of 100
  });

  it("returns large sigma for slider = 1 (uncertain)", () => {
    const sigma = sliderToSigma(1, rangeWidth);
    expect(sigma).toBeCloseTo(50, 0); // 50% of 100
  });

  it("increases monotonically with slider value", () => {
    let prev = 0;
    for (let s = 0; s <= 1; s += 0.1) {
      const sigma = sliderToSigma(s, rangeWidth);
      expect(sigma).toBeGreaterThan(prev);
      prev = sigma;
    }
  });
});

describe("sigmaToSlider", () => {
  it("returns 0.5 for invalid inputs", () => {
    expect(sigmaToSlider(0, 100)).toBe(0.5);
    expect(sigmaToSlider(10, 0)).toBe(0.5);
    expect(sigmaToSlider(-1, 100)).toBe(0.5);
  });

  it("clamps to [0, 1]", () => {
    expect(sigmaToSlider(0.001, 100)).toBe(0);
    expect(sigmaToSlider(10000, 100)).toBe(1);
  });
});

describe("slider ↔ sigma roundtrip", () => {
  const rangeWidth = 100;

  it.each([0.1, 0.25, 0.5, 0.75, 0.9])(
    "roundtrips for slider = %s",
    (slider) => {
      const sigma = sliderToSigma(slider, rangeWidth);
      const back = sigmaToSlider(sigma, rangeWidth);
      expect(back).toBeCloseTo(slider, 8);
    },
  );
});
