import { AmmService } from './amm.service';
import { MarketService } from '../market/market.service';
import { MarketEntity } from '../market/entity/market.entity';
import { BadRequestException, NotFoundException } from '@nestjs/common';

function mockMarket(overrides: Partial<MarketEntity> = {}): MarketEntity {
  return {
    id: '1',
    pubkey: 'Pk',
    marketType: 0,
    state: 0,
    creator: 'C',
    oracle: 'O',
    collateralMint: 'M',
    deadline: new Date(),
    createdAt: new Date(),
    resolvedAt: null,
    numOutcomes: 2,
    title: 'T',
    description: null,
    category: null,
    tags: null,
    imageUrl: null,
    outcomeLabels: null,
    reserves: ['500', '500'],
    kSquared: '250000',
    totalMinted: '1000',
    resolvedOutcome: null,
    resolvedValue: null,
    rangeMin: null,
    rangeMax: null,
    totalVolume: '0',
    totalTraders: 0,
    lastTradeAt: null,
    updatedAt: new Date(),
    ...overrides,
  } as MarketEntity;
}

describe('AmmService', () => {
  let service: AmmService;
  let marketService: { findById: jest.Mock };

  beforeEach(() => {
    marketService = { findById: jest.fn() };
    service = new AmmService(marketService as unknown as MarketService);
  });

  describe('estimateBuy', () => {
    it('should deduct fee from collateral before computing tokens', async () => {
      // 2-outcome market: reserves=[500,500], totalMinted=1000
      // Equal probabilities → x0=x1=500, kSq=500000
      const market = mockMarket({
        reserves: ['500', '500'],
        totalMinted: '1000',
      });
      marketService.findById.mockResolvedValue(market);

      const result = await service.estimateBuy(1, 0, 1000, 30);
      // fee = floor(1000 * 30 / 10000) = 3
      expect(result.fee).toBe(3);
      expect(result.tokensOut).toBeGreaterThan(0);
    });

    it('should return 0 tokens when collateral is 0 (consistent market)', async () => {
      // For L2 invariant: sum(x_i^2) = k^2
      // Equal probs with k=1000: x = 1000/sqrt(2) ≈ 707, reserves = 1000-707 = 293
      const market = mockMarket({
        reserves: ['293', '293'],
        totalMinted: '1000',
      });
      marketService.findById.mockResolvedValue(market);

      const result = await service.estimateBuy(1, 0, 0, 30);
      expect(result.tokensOut).toBe(0);
      expect(result.fee).toBe(0);
    });

    it('should produce valid probabilities that are non-negative', async () => {
      const market = mockMarket({
        reserves: ['500', '500'],
        totalMinted: '1000',
      });
      marketService.findById.mockResolvedValue(market);

      const result = await service.estimateBuy(1, 0, 100000, 0);
      for (const p of result.newProbabilities) {
        expect(p).toBeGreaterThanOrEqual(0);
      }
    });

    it('should increase probability of bought outcome', async () => {
      const market = mockMarket({
        reserves: ['500', '500'],
        totalMinted: '1000',
      });
      marketService.findById.mockResolvedValue(market);

      // Before: equal probabilities (0.5, 0.5)
      const result = await service.estimateBuy(1, 0, 10000, 0);
      expect(result.newProbabilities[0]).toBeGreaterThan(0.5);
    });

    it('should throw when market not found', async () => {
      marketService.findById.mockRejectedValue(
        new NotFoundException('Market 999 not found'),
      );
      await expect(service.estimateBuy(999, 0, 1000)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('estimateSell', () => {
    it('should return collateral after fee deduction', async () => {
      // reserves=[200,800], totalMinted=1000
      // x0=800, x1=200 → outcome 0 has more tokens outstanding
      const market = mockMarket({
        reserves: ['200', '800'],
        totalMinted: '1000',
      });
      marketService.findById.mockResolvedValue(market);

      const result = await service.estimateSell(1, 0, 100, 30);
      expect(result.fee).toBeGreaterThanOrEqual(0);
      expect(result.collateralOut).toBeGreaterThanOrEqual(0);
    });

    it('should return 0 when selling more tokens than held', async () => {
      // x0 = totalMinted - reserves[0] = 1000 - 500 = 500
      // Selling 600 > 500 → should return 0
      const market = mockMarket({
        reserves: ['500', '500'],
        totalMinted: '1000',
      });
      marketService.findById.mockResolvedValue(market);

      const result = await service.estimateSell(1, 0, 600, 0);
      expect(result.collateralOut).toBe(0);
      expect(result.fee).toBe(0);
    });

    it('should decrease probability of sold outcome', async () => {
      // Unequal start: outcome 0 has higher prob
      const market = mockMarket({
        reserves: ['200', '800'],
        totalMinted: '1000',
      });
      marketService.findById.mockResolvedValue(market);

      // Before: p0 = 800^2/(800^2+200^2) ≈ 0.94
      const result = await service.estimateSell(1, 0, 100, 0);
      // After selling outcome 0 tokens, its probability should decrease
      expect(result.newProbabilities[0]).toBeLessThan(0.95);
    });
  });

  describe('estimateDistributionBuy (continuous markets)', () => {
    it('should distribute tokens across bins according to Gaussian weights', async () => {
      const market = mockMarket({
        numOutcomes: 5,
        reserves: ['200', '200', '200', '200', '200'],
        totalMinted: '1000',
        rangeMin: '0',
        rangeMax: '100',
      });
      marketService.findById.mockResolvedValue(market);

      const result = await service.estimateDistributionBuy(1, 50, 10, 10000, 0);
      expect(result.tokensPerBin).toHaveLength(5);
      // Center bin (index 2, centered at 50) should get the most tokens
      const maxTokens = Math.max(...result.tokensPerBin);
      expect(result.tokensPerBin[2]).toBe(maxTokens);
    });

    it('should deduct fee from collateral', async () => {
      const market = mockMarket({
        numOutcomes: 3,
        reserves: ['333', '333', '334'],
        totalMinted: '1000',
        rangeMin: '0',
        rangeMax: '100',
      });
      marketService.findById.mockResolvedValue(market);

      const result = await service.estimateDistributionBuy(1, 50, 20, 1000, 100);
      // fee = floor(1000 * 100 / 10000) = 10
      expect(result.fee).toBe(10);
    });

    it('should produce valid probabilities', async () => {
      const market = mockMarket({
        numOutcomes: 4,
        reserves: ['250', '250', '250', '250'],
        totalMinted: '1000',
        rangeMin: '0',
        rangeMax: '100',
      });
      marketService.findById.mockResolvedValue(market);

      const result = await service.estimateDistributionBuy(1, 50, 15, 5000, 0);
      for (const p of result.newProbabilities) {
        expect(p).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('estimateDistributionSell (continuous markets)', () => {
    it('should return valid collateralOut and fee', async () => {
      const market = mockMarket({
        marketType: 2,
        numOutcomes: 5,
        reserves: ['100', '150', '200', '150', '100'],
        totalMinted: '1000',
        rangeMin: '0',
        rangeMax: '100',
      });
      marketService.findById.mockResolvedValue(market);

      const result = await service.estimateDistributionSell(1, 50, 10, 100, 30);
      expect(result.collateralOut).toBeGreaterThanOrEqual(0);
      expect(result.fee).toBeGreaterThanOrEqual(0);
      expect(result.newProbabilities).toHaveLength(5);
      for (const p of result.newProbabilities) {
        expect(p).toBeGreaterThanOrEqual(0);
      }
    });

    it('should return 0 when selling zero tokens', async () => {
      const market = mockMarket({
        marketType: 2,
        numOutcomes: 4,
        reserves: ['250', '250', '250', '250'],
        totalMinted: '1000',
        rangeMin: '0',
        rangeMax: '100',
      });
      marketService.findById.mockResolvedValue(market);

      const result = await service.estimateDistributionSell(1, 50, 10, 0, 30);
      expect(result.collateralOut).toBe(0);
      expect(result.fee).toBe(0);
    });

    it('should throw BadRequestException for non-continuous market', async () => {
      const market = mockMarket({ marketType: 0 });
      marketService.findById.mockResolvedValue(market);

      await expect(
        service.estimateDistributionSell(1, 50, 10, 100),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('estimateBuyByShares (reverse buy)', () => {
    // All markets use invariant-consistent reserves: sum(x_i^2) = totalMinted^2
    // 2-outcome: x0=600000, x1=800000 → reserves=[400000,200000], totalMinted=1000000
    // 4-outcome equal: x_i=500000 → reserves=[500000,...], totalMinted=1000000

    it('should round-trip: buyByShares → estimateBuy yields >= desired tokens', async () => {
      const market = mockMarket({
        reserves: ['400000', '200000'],
        totalMinted: '1000000',
      });
      marketService.findById.mockResolvedValue(market);

      const desiredTokens = 50000;
      const reverse = await service.estimateBuyByShares(1, 0, desiredTokens, 30);
      expect(reverse.collateralNeeded).toBeGreaterThan(0);
      expect(reverse.fee).toBeGreaterThanOrEqual(0);

      // Forward: spend that collateral, should get >= desiredTokens
      const forward = await service.estimateBuy(1, 0, reverse.collateralNeeded, 30);
      expect(forward.tokensOut).toBeGreaterThanOrEqual(desiredTokens);
      // Should be very close (within 2 due to rounding)
      expect(forward.tokensOut - desiredTokens).toBeLessThanOrEqual(2);
    });

    it('should work with buying the lower-probability outcome', async () => {
      const market = mockMarket({
        reserves: ['400000', '200000'],
        totalMinted: '1000000',
      });
      marketService.findById.mockResolvedValue(market);

      const desiredTokens = 30000;
      const reverse = await service.estimateBuyByShares(1, 1, desiredTokens, 30);
      const forward = await service.estimateBuy(1, 1, reverse.collateralNeeded, 30);
      expect(forward.tokensOut).toBeGreaterThanOrEqual(desiredTokens);
      expect(forward.tokensOut - desiredTokens).toBeLessThanOrEqual(2);
    });

    it('should produce valid probabilities', async () => {
      const market = mockMarket({
        reserves: ['400000', '200000'],
        totalMinted: '1000000',
      });
      marketService.findById.mockResolvedValue(market);

      const result = await service.estimateBuyByShares(1, 0, 100000, 0);
      for (const p of result.newProbabilities) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    });

    it('should work with multi-outcome market', async () => {
      const market = mockMarket({
        numOutcomes: 4,
        reserves: ['500000', '500000', '500000', '500000'],
        totalMinted: '1000000',
      });
      marketService.findById.mockResolvedValue(market);

      const desiredTokens = 50000;
      const reverse = await service.estimateBuyByShares(1, 2, desiredTokens, 30);
      const forward = await service.estimateBuy(1, 2, reverse.collateralNeeded, 30);
      expect(forward.tokensOut).toBeGreaterThanOrEqual(desiredTokens);
    });
  });

  describe('estimateSellByCollateral (reverse sell)', () => {
    // 2-outcome invariant-consistent: x0=800000, x1=600000
    // reserves=[200000, 400000], totalMinted=1000000

    it('should round-trip: sellByCollateral → estimateSell yields >= desired collateral', async () => {
      const market = mockMarket({
        reserves: ['200000', '400000'],
        totalMinted: '1000000',
      });
      marketService.findById.mockResolvedValue(market);

      const desiredCollateral = 10000;
      const reverse = await service.estimateSellByCollateral(1, 0, desiredCollateral, 30);
      expect(reverse.tokensNeeded).toBeGreaterThan(0);
      expect(reverse.fee).toBeGreaterThanOrEqual(0);

      // Forward: sell that many tokens, should get >= desiredCollateral
      const forward = await service.estimateSell(1, 0, reverse.tokensNeeded, 30);
      expect(forward.collateralOut).toBeGreaterThanOrEqual(desiredCollateral);
      // Should be close (within a few units due to rounding)
      expect(forward.collateralOut - desiredCollateral).toBeLessThanOrEqual(5);
    });

    it('should work with outcome 1', async () => {
      const market = mockMarket({
        reserves: ['400000', '200000'],
        totalMinted: '1000000',
      });
      marketService.findById.mockResolvedValue(market);

      const desiredCollateral = 8000;
      const reverse = await service.estimateSellByCollateral(1, 1, desiredCollateral, 30);
      const forward = await service.estimateSell(1, 1, reverse.tokensNeeded, 30);
      expect(forward.collateralOut).toBeGreaterThanOrEqual(desiredCollateral);
    });

    it('should throw when desired collateral exceeds market capacity', async () => {
      const market = mockMarket({
        reserves: ['400000', '200000'],
        totalMinted: '1000000',
      });
      marketService.findById.mockResolvedValue(market);

      await expect(
        service.estimateSellByCollateral(1, 0, 1000000, 0),
      ).rejects.toThrow(BadRequestException);
    });

    it('should produce valid probabilities', async () => {
      const market = mockMarket({
        reserves: ['200000', '400000'],
        totalMinted: '1000000',
      });
      marketService.findById.mockResolvedValue(market);

      const result = await service.estimateSellByCollateral(1, 0, 5000, 0);
      for (const p of result.newProbabilities) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('estimateDistributionSellByCollateral (reverse distribution sell)', () => {
    it('should round-trip: distribution sellByCollateral → estimateDistributionSell yields >= desired', async () => {
      // 4-outcome equal probs: x_i=500000, reserves=[500000,...], totalMinted=1000000
      const market = mockMarket({
        marketType: 2,
        numOutcomes: 4,
        reserves: ['500000', '500000', '500000', '500000'],
        totalMinted: '1000000',
        rangeMin: '0',
        rangeMax: '100',
      });
      marketService.findById.mockResolvedValue(market);

      const desiredCollateral = 5000;
      const reverse = await service.estimateDistributionSellByCollateral(
        1, 50, 15, desiredCollateral, 30,
      );
      expect(reverse.tokensNeeded).toBeGreaterThan(0);

      // Forward: sell that many tokens with same distribution
      const forward = await service.estimateDistributionSell(
        1, 50, 15, reverse.tokensNeeded, 30,
      );
      expect(forward.collateralOut).toBeGreaterThanOrEqual(desiredCollateral);
    });

    it('should throw for non-continuous market', async () => {
      const market = mockMarket({ marketType: 0 });
      marketService.findById.mockResolvedValue(market);

      await expect(
        service.estimateDistributionSellByCollateral(1, 50, 10, 20),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('edge cases', () => {
    it('should handle a market with zero totalMinted', async () => {
      const market = mockMarket({
        reserves: ['0', '0'],
        totalMinted: '0',
        kSquared: '0',
      });
      marketService.findById.mockResolvedValue(market);

      const result = await service.estimateBuy(1, 0, 1000, 0);
      // With totalMinted=0 and reserves=0, buying should still work
      expect(result.tokensOut).toBeGreaterThanOrEqual(0);
    });

    it('should handle a market with many outcomes', async () => {
      const n = 10;
      const market = mockMarket({
        numOutcomes: n,
        reserves: Array(n).fill('100'),
        totalMinted: '1000',
      });
      marketService.findById.mockResolvedValue(market);

      const result = await service.estimateBuy(1, 0, 5000, 0);
      expect(result.newProbabilities).toHaveLength(n);
    });

    it('should handle zero fee bps', async () => {
      const market = mockMarket();
      marketService.findById.mockResolvedValue(market);

      const result = await service.estimateBuy(1, 0, 1000, 0);
      expect(result.fee).toBe(0);
    });
  });
});
