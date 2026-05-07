import { computeBinWeights } from './normal';

const SCALE = 1_000_000_000;

describe('computeBinWeights', () => {
  describe('basic properties', () => {
    it('should return weights that sum to SCALE', () => {
      const weights = computeBinWeights(0, 1_000_000_000, 10, 500_000_000, 100_000_000);
      const sum = weights.reduce((a, b) => a + b, 0);
      expect(sum).toBe(SCALE);
    });

    it('should return array of correct length', () => {
      const weights = computeBinWeights(0, 1_000_000_000, 64, 500_000_000, 100_000_000);
      expect(weights).toHaveLength(64);
    });

    it('should have all non-negative weights', () => {
      const weights = computeBinWeights(0, 1_000_000_000, 10, 500_000_000, 100_000_000);
      for (const w of weights) {
        expect(w).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Gaussian shape', () => {
    it('should concentrate weight near mu (center of range)', () => {
      const weights = computeBinWeights(0, 1_000_000_000, 10, 500_000_000, 50_000_000);
      // Center bin (bin 5, center at 550M) should have highest weight.
      // Actually bin 4 (center at 450M) and bin 5 (center at 550M) bracket mu=500M.
      const maxWeight = Math.max(...weights);
      const maxIdx = weights.indexOf(maxWeight);
      expect(maxIdx).toBeGreaterThanOrEqual(4);
      expect(maxIdx).toBeLessThanOrEqual(5);
    });

    it('should be symmetric when mu is at center of range', () => {
      const weights = computeBinWeights(0, 1_000_000_000, 10, 500_000_000, 100_000_000);
      // Bins equidistant from center should have similar weights.
      for (let i = 0; i < 5; i++) {
        const diff = Math.abs(weights[i] - weights[9 - i]);
        // Allow small rounding difference due to integer rounding.
        expect(diff).toBeLessThanOrEqual(2);
      }
    });

    it('should have narrow distribution with small sigma', () => {
      // sigma = 10M on range [0, 1B] with 100 bins → bin width 10M
      // Only 1-2 bins should have significant weight.
      const weights = computeBinWeights(0, 1_000_000_000, 100, 500_000_000, 10_000_000);
      const nonZero = weights.filter((w) => w > 0);
      // Within ±5 sigma (bin width = 10M, sigma = 10M) → ~10 bins get weight.
      expect(nonZero.length).toBeLessThanOrEqual(12);
      expect(nonZero.length).toBeGreaterThanOrEqual(1);
    });

    it('should spread weight widely with large sigma', () => {
      // sigma = 500M on range [0, 1B] → very flat distribution.
      const weights = computeBinWeights(0, 1_000_000_000, 10, 500_000_000, 500_000_000);
      const nonZero = weights.filter((w) => w > 0);
      // All bins should have weight (z_max < 1 for all bins).
      expect(nonZero.length).toBe(10);
      // Weights should be relatively uniform.
      const min = Math.min(...weights);
      const max = Math.max(...weights);
      expect(max / min).toBeLessThan(2);
    });
  });

  describe('edge cases: mu at boundaries', () => {
    it('should still produce valid weights when mu = rangeMin', () => {
      const weights = computeBinWeights(0, 1_000_000_000, 10, 0, 100_000_000);
      const sum = weights.reduce((a, b) => a + b, 0);
      expect(sum).toBe(SCALE);
      // First bin should have highest weight.
      expect(weights[0]).toBeGreaterThan(weights[9]);
    });

    it('should still produce valid weights when mu = rangeMax', () => {
      const weights = computeBinWeights(0, 1_000_000_000, 10, 1_000_000_000, 100_000_000);
      const sum = weights.reduce((a, b) => a + b, 0);
      expect(sum).toBe(SCALE);
      // Last bin should have highest weight.
      expect(weights[9]).toBeGreaterThan(weights[0]);
    });

    it('should handle mu well outside range (all tails clipped)', () => {
      // mu = 10B, sigma = 100M → all bins at z > 5, all raw weights = 0.
      // Should fall back to nearest-bin strategy.
      const weights = computeBinWeights(0, 1_000_000_000, 10, 10_000_000_000, 100_000_000);
      const sum = weights.reduce((a, b) => a + b, 0);
      expect(sum).toBe(SCALE);
      // Nearest bin to mu is the last one.
      expect(weights[9]).toBe(SCALE);
    });

    it('should handle mu below range (nearest bin = 0)', () => {
      const weights = computeBinWeights(0, 1_000_000_000, 10, -10_000_000_000, 100_000_000);
      const sum = weights.reduce((a, b) => a + b, 0);
      expect(sum).toBe(SCALE);
      // Nearest bin should be bin 0.
      expect(weights[0]).toBe(SCALE);
    });
  });

  describe('invalid inputs', () => {
    it('should return zeros for sigma = 0', () => {
      const weights = computeBinWeights(0, 1_000_000_000, 10, 500_000_000, 0);
      expect(weights.every((w) => w === 0)).toBe(true);
    });

    it('should return zeros for negative sigma', () => {
      const weights = computeBinWeights(0, 1_000_000_000, 10, 500_000_000, -100);
      expect(weights.every((w) => w === 0)).toBe(true);
    });

    it('should return zeros for numBins = 0', () => {
      const weights = computeBinWeights(0, 1_000_000_000, 0, 500_000_000, 100_000_000);
      expect(weights).toHaveLength(0);
    });

    it('should return zeros when rangeMax <= rangeMin', () => {
      const weights = computeBinWeights(1_000_000_000, 0, 10, 500_000_000, 100_000_000);
      expect(weights.every((w) => w === 0)).toBe(true);
    });

    it('should return zeros when rangeMax = rangeMin', () => {
      const weights = computeBinWeights(500, 500, 10, 500, 100);
      expect(weights.every((w) => w === 0)).toBe(true);
    });
  });

  describe('consistency with on-chain computation', () => {
    it('should have weights sum to exactly SCALE for various configs', () => {
      const configs = [
        { rangeMin: 0, rangeMax: 1_000_000_000, numBins: 2, mu: 500_000_000, sigma: 200_000_000 },
        { rangeMin: 0, rangeMax: 1_000_000_000, numBins: 4, mu: 250_000_000, sigma: 100_000_000 },
        { rangeMin: 0, rangeMax: 1_000_000_000, numBins: 64, mu: 500_000_000, sigma: 50_000_000 },
        { rangeMin: 0, rangeMax: 1_000_000_000, numBins: 128, mu: 700_000_000, sigma: 80_000_000 },
        { rangeMin: -1_000_000_000, rangeMax: 1_000_000_000, numBins: 256, mu: 0, sigma: 300_000_000 },
      ];
      for (const c of configs) {
        const weights = computeBinWeights(c.rangeMin, c.rangeMax, c.numBins, c.mu, c.sigma);
        const sum = weights.reduce((a, b) => a + b, 0);
        expect(sum).toBe(SCALE);
        expect(weights).toHaveLength(c.numBins);
      }
    });

    it('should produce monotonically decreasing weights away from mu', () => {
      // 10 bins, mu at center. Bins further from center should have lower weight.
      const weights = computeBinWeights(0, 1_000_000_000, 10, 500_000_000, 100_000_000);
      // Find the peak (should be at index 4 or 5).
      const maxIdx = weights.indexOf(Math.max(...weights));
      // Going left from peak: weights should decrease.
      for (let i = maxIdx - 1; i > 0; i--) {
        expect(weights[i]).toBeGreaterThanOrEqual(weights[i - 1]);
      }
      // Going right from peak: weights should decrease.
      for (let i = maxIdx + 1; i < weights.length - 1; i++) {
        expect(weights[i]).toBeGreaterThanOrEqual(weights[i + 1]);
      }
    });
  });
});
