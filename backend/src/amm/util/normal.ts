const SCALE = 1_000_000_000;

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

    // Clamp tails at |z| > 5
    if (Math.abs(z) > 5) {
      rawWeights.push(0);
      continue;
    }

    // PDF proportional to exp(-z^2 / 2)
    const weight = Math.exp(-0.5 * z * z);
    rawWeights.push(weight);
    totalWeight += weight;
  }

  // Normalize so weights sum to SCALE
  if (totalWeight === 0) {
    // All weight outside range — put everything in nearest bin
    const centerBin = Math.floor(
      ((mu - rangeMin) / (rangeMax - rangeMin)) * numBins,
    );
    const clampedBin = Math.max(0, Math.min(numBins - 1, centerBin));
    const result = Array(numBins).fill(0);
    result[clampedBin] = SCALE;
    return result;
  }

  return rawWeights.map((w) => Math.round((w / totalWeight) * SCALE));
}
