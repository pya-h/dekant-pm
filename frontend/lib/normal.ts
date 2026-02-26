/**
 * Normal distribution bin weight computation for continuous markets.
 * Mirrors backend/src/amm/util/normal.ts logic.
 * Uses human-readable values (not SCALE-denominated) since z-scores are scale-invariant.
 */

const Z_CUTOFF = 5;

/**
 * Compute normalized bin weights for Normal(mu, sigma) over numBins equal-width bins
 * spanning [rangeMin, rangeMax]. Returns probabilities summing to ~1.
 */
export function computeBinWeights(
  rangeMin: number,
  rangeMax: number,
  numBins: number,
  mu: number,
  sigma: number,
): number[] {
  if (sigma <= 0 || numBins <= 0 || rangeMax <= rangeMin) {
    return Array(numBins).fill(0);
  }

  const binWidth = (rangeMax - rangeMin) / numBins;
  const rawWeights: number[] = [];
  let totalWeight = 0;

  for (let i = 0; i < numBins; i++) {
    const binCenter = rangeMin + (i + 0.5) * binWidth;
    const z = (binCenter - mu) / sigma;

    if (Math.abs(z) > Z_CUTOFF) {
      rawWeights.push(0);
      continue;
    }

    const weight = Math.exp(-0.5 * z * z);
    rawWeights.push(weight);
    totalWeight += weight;
  }

  if (totalWeight === 0) {
    return Array(numBins).fill(0);
  }

  return rawWeights.map((w) => w / totalWeight);
}

// Log-scale mapping boundaries for confidence slider
const LN_FRAC_MIN = Math.log(1 / 100); // sigma = 1% of range width (very sure)
const LN_FRAC_MAX = Math.log(1 / 2); // sigma = 50% of range width (very uncertain)

/**
 * Map slider position [0, 1] to sigma using log scale.
 * 0 = "Very sure" (narrow), 1 = "Uncertain" (wide)
 */
export function sliderToSigma(
  sliderValue: number,
  rangeWidth: number,
): number {
  const lnFrac = LN_FRAC_MIN + sliderValue * (LN_FRAC_MAX - LN_FRAC_MIN);
  return rangeWidth * Math.exp(lnFrac);
}

/**
 * Inverse of sliderToSigma: map sigma to slider position [0, 1].
 */
export function sigmaToSlider(sigma: number, rangeWidth: number): number {
  if (rangeWidth <= 0 || sigma <= 0) return 0.5;
  const lnFrac = Math.log(sigma / rangeWidth);
  return Math.max(
    0,
    Math.min(1, (lnFrac - LN_FRAC_MIN) / (LN_FRAC_MAX - LN_FRAC_MIN)),
  );
}
