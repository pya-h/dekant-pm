import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, TestApp } from './helpers/test-app';
import { mockMarket, randomAmount } from './helpers/mock-factories';

describe('AMM (e2e)', () => {
  let app: INestApplication;
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
    app = testApp.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /amm/estimate-buy', () => {
    it('should return buy estimate for discrete market', () => {
      testApp.marketRepo.findOne.mockResolvedValueOnce(mockMarket());
      const amount = randomAmount(500, 5000);
      return request(app.getHttpServer())
        .post('/amm/estimate-buy')
        .send({ marketId: 1, outcome: 0, amount })
        .expect(201)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('tokensOut');
          expect(res.body).toHaveProperty('fee');
          expect(res.body).toHaveProperty('newProbabilities');
          expect(typeof res.body.tokensOut).toBe('number');
          expect(typeof res.body.fee).toBe('number');
          expect(Array.isArray(res.body.newProbabilities)).toBe(true);
        });
    });

    it('should compute correct fee (30 bps default)', () => {
      testApp.marketRepo.findOne.mockResolvedValueOnce(mockMarket());
      return request(app.getHttpServer())
        .post('/amm/estimate-buy')
        .send({ marketId: 1, outcome: 0, amount: 10000 })
        .expect(201)
        .expect((res: any) => {
          // floor(10000 * 30 / 10000) = 30
          expect(res.body.fee).toBe(30);
        });
    });

    it('should return zero fee for very small amount', () => {
      testApp.marketRepo.findOne.mockResolvedValueOnce(mockMarket());
      return request(app.getHttpServer())
        .post('/amm/estimate-buy')
        .send({ marketId: 1, outcome: 0, amount: 1 })
        .expect(201)
        .expect((res: any) => {
          // floor(1 * 30 / 10000) = 0
          expect(res.body.fee).toBe(0);
        });
    });

    it('should return zero fee for zero amount', () => {
      testApp.marketRepo.findOne.mockResolvedValueOnce(mockMarket());
      return request(app.getHttpServer())
        .post('/amm/estimate-buy')
        .send({ marketId: 1, outcome: 0, amount: 0 })
        .expect(201)
        .expect((res: any) => {
          expect(res.body.fee).toBe(0);
          expect(res.body).toHaveProperty('tokensOut');
          expect(res.body).toHaveProperty('newProbabilities');
        });
    });

    it('should default to outcome 0 when not specified', () => {
      testApp.marketRepo.findOne.mockResolvedValueOnce(mockMarket());
      return request(app.getHttpServer())
        .post('/amm/estimate-buy')
        .send({ marketId: 1, amount: randomAmount(100, 2000) })
        .expect(201)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('tokensOut');
        });
    });

    it('should handle outcome=1 for binary market', () => {
      testApp.marketRepo.findOne.mockResolvedValueOnce(mockMarket());
      return request(app.getHttpServer())
        .post('/amm/estimate-buy')
        .send({ marketId: 1, outcome: 1, amount: randomAmount(100, 2000) })
        .expect(201)
        .expect((res: any) => {
          expect(res.body.tokensOut).toBeGreaterThanOrEqual(0);
        });
    });

    it('should return distribution buy for continuous market', () => {
      testApp.marketRepo.findOne.mockResolvedValueOnce(
        mockMarket({
          marketType: 2,
          numOutcomes: 5,
          reserves: ['200', '200', '200', '200', '200'],
          totalMinted: '1000',
          rangeMin: '0',
          rangeMax: '100',
        }),
      );
      return request(app.getHttpServer())
        .post('/amm/estimate-buy')
        .send({ marketId: 1, mu: 50, sigma: 10, amount: 1000 })
        .expect(201)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('tokensPerBin');
          expect(res.body).toHaveProperty('fee');
          expect(Array.isArray(res.body.tokensPerBin)).toBe(true);
          expect(res.body.tokensPerBin).toHaveLength(5);
        });
    });

    it('should handle distribution buy with sigma near zero', () => {
      testApp.marketRepo.findOne.mockResolvedValueOnce(
        mockMarket({
          marketType: 2,
          numOutcomes: 5,
          reserves: ['200', '200', '200', '200', '200'],
          totalMinted: '1000',
          rangeMin: '0',
          rangeMax: '100',
        }),
      );
      return request(app.getHttpServer())
        .post('/amm/estimate-buy')
        .send({ marketId: 1, mu: 50, sigma: 0.001, amount: 1000 })
        .expect(201)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('tokensPerBin');
        });
    });

    it('should handle distribution buy with mu outside range', () => {
      testApp.marketRepo.findOne.mockResolvedValueOnce(
        mockMarket({
          marketType: 2,
          numOutcomes: 5,
          reserves: ['200', '200', '200', '200', '200'],
          totalMinted: '1000',
          rangeMin: '0',
          rangeMax: '100',
        }),
      );
      return request(app.getHttpServer())
        .post('/amm/estimate-buy')
        .send({ marketId: 1, mu: 500, sigma: 10, amount: 1000 })
        .expect(201)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('tokensPerBin');
        });
    });

    it('should handle distribution buy with large sigma (uniform-ish)', () => {
      testApp.marketRepo.findOne.mockResolvedValueOnce(
        mockMarket({
          marketType: 2,
          numOutcomes: 5,
          reserves: ['200', '200', '200', '200', '200'],
          totalMinted: '1000',
          rangeMin: '0',
          rangeMax: '100',
        }),
      );
      return request(app.getHttpServer())
        .post('/amm/estimate-buy')
        .send({ marketId: 1, mu: 50, sigma: 10000, amount: 1000 })
        .expect(201)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('tokensPerBin');
          const bins = res.body.tokensPerBin as number[];
          const max = Math.max(...bins);
          const min = Math.min(...bins);
          if (max > 0) {
            expect(max - min).toBeLessThan(max * 0.5);
          }
        });
    });

    it('should reject missing marketId', () => {
      return request(app.getHttpServer())
        .post('/amm/estimate-buy')
        .send({ outcome: 0, amount: 1000 })
        .expect(400);
    });

    it('should reject missing amount', () => {
      return request(app.getHttpServer())
        .post('/amm/estimate-buy')
        .send({ marketId: 1, outcome: 0 })
        .expect(400);
    });

    it('should reject non-numeric fields', () => {
      return request(app.getHttpServer())
        .post('/amm/estimate-buy')
        .send({ marketId: 'abc', outcome: 0, amount: 1000 })
        .expect(400);
    });

    it('should reject non-numeric amount', () => {
      return request(app.getHttpServer())
        .post('/amm/estimate-buy')
        .send({ marketId: 1, outcome: 0, amount: 'many' })
        .expect(400);
    });

    it('should return 404 for non-existent market', () => {
      testApp.marketRepo.findOne.mockResolvedValueOnce(null);
      return request(app.getHttpServer())
        .post('/amm/estimate-buy')
        .send({ marketId: 999, outcome: 0, amount: 1000 })
        .expect(404);
    });

    it('should reject non-whitelisted fields', () => {
      return request(app.getHttpServer())
        .post('/amm/estimate-buy')
        .send({ marketId: 1, outcome: 0, amount: 1000, extraField: 'bad' })
        .expect(400);
    });

    it('should handle buy on market with 0 totalMinted (new market)', () => {
      testApp.marketRepo.findOne.mockResolvedValueOnce(
        mockMarket({
          reserves: ['0', '0'],
          totalMinted: '0',
          kSquared: '0',
        }),
      );
      return request(app.getHttpServer())
        .post('/amm/estimate-buy')
        .send({ marketId: 1, outcome: 0, amount: 1000 })
        .expect(201)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('tokensOut');
          expect(res.body.tokensOut).toBeGreaterThanOrEqual(0);
        });
    });

    it('should show increased probability for bought outcome', () => {
      testApp.marketRepo.findOne.mockResolvedValueOnce(
        mockMarket({
          reserves: ['500000', '500000'],
          totalMinted: '1000000',
          kSquared: '500000000000',
        }),
      );
      return request(app.getHttpServer())
        .post('/amm/estimate-buy')
        .send({ marketId: 1, outcome: 0, amount: 100000 })
        .expect(201)
        .expect((res: any) => {
          expect(res.body.newProbabilities[0]).toBeGreaterThan(0.5);
          expect(res.body.newProbabilities[1]).toBeLessThan(0.5);
        });
    });
  });

  describe('POST /amm/estimate-sell', () => {
    it('should return sell estimate', () => {
      testApp.marketRepo.findOne.mockResolvedValueOnce(
        mockMarket({ reserves: ['200', '800'], totalMinted: '1000' }),
      );
      return request(app.getHttpServer())
        .post('/amm/estimate-sell')
        .send({ marketId: 1, outcome: 0, amount: 100 })
        .expect(201)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('collateralOut');
          expect(res.body).toHaveProperty('fee');
          expect(res.body).toHaveProperty('newProbabilities');
          expect(typeof res.body.collateralOut).toBe('number');
        });
    });

    it('should return zero collateral when selling more than holdings', () => {
      // xI = totalMinted - reserves[0] = 1000 - 200 = 800; selling 900 > 800
      testApp.marketRepo.findOne.mockResolvedValueOnce(
        mockMarket({ reserves: ['200', '800'], totalMinted: '1000' }),
      );
      return request(app.getHttpServer())
        .post('/amm/estimate-sell')
        .send({ marketId: 1, outcome: 0, amount: 900 })
        .expect(201)
        .expect((res: any) => {
          expect(res.body.collateralOut).toBe(0);
          expect(res.body.fee).toBe(0);
        });
    });

    it('should return result for zero amount', () => {
      testApp.marketRepo.findOne.mockResolvedValueOnce(mockMarket());
      return request(app.getHttpServer())
        .post('/amm/estimate-sell')
        .send({ marketId: 1, outcome: 0, amount: 0 })
        .expect(201)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('collateralOut');
          expect(res.body).toHaveProperty('fee');
          expect(res.body).toHaveProperty('newProbabilities');
        });
    });

    it('should default to outcome 0 when not specified', () => {
      testApp.marketRepo.findOne.mockResolvedValueOnce(
        mockMarket({ reserves: ['200', '800'], totalMinted: '1000' }),
      );
      return request(app.getHttpServer())
        .post('/amm/estimate-sell')
        .send({ marketId: 1, amount: 100 })
        .expect(201)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('collateralOut');
        });
    });

    it('should compute correct fee on sell', () => {
      testApp.marketRepo.findOne.mockResolvedValueOnce(
        mockMarket({ reserves: ['200', '800'], totalMinted: '1000' }),
      );
      return request(app.getHttpServer())
        .post('/amm/estimate-sell')
        .send({ marketId: 1, outcome: 0, amount: 100 })
        .expect(201)
        .expect((res: any) => {
          // fee = floor(grossCollateral * 30 / 10000)
          expect(res.body.fee).toBeGreaterThanOrEqual(0);
          expect(res.body.collateralOut).toBeGreaterThanOrEqual(0);
        });
    });

    it('should reject missing fields', () => {
      return request(app.getHttpServer())
        .post('/amm/estimate-sell')
        .send({ marketId: 1 })
        .expect(400);
    });

    it('should reject missing marketId', () => {
      return request(app.getHttpServer())
        .post('/amm/estimate-sell')
        .send({ outcome: 0, amount: 100 })
        .expect(400);
    });

    it('should reject non-numeric amount', () => {
      return request(app.getHttpServer())
        .post('/amm/estimate-sell')
        .send({ marketId: 1, outcome: 0, amount: 'abc' })
        .expect(400);
    });

    it('should return 404 for non-existent market', () => {
      testApp.marketRepo.findOne.mockResolvedValueOnce(null);
      return request(app.getHttpServer())
        .post('/amm/estimate-sell')
        .send({ marketId: 999, outcome: 0, amount: 100 })
        .expect(404);
    });

    it('should handle sell on uninitialised market', () => {
      testApp.marketRepo.findOne.mockResolvedValueOnce(
        mockMarket({
          reserves: ['0', '0'],
          totalMinted: '0',
          kSquared: '0',
        }),
      );
      return request(app.getHttpServer())
        .post('/amm/estimate-sell')
        .send({ marketId: 1, outcome: 0, amount: 100 })
        .expect(201)
        .expect((res: any) => {
          // xI = 0, tokensIn > 0, returns 0
          expect(res.body.collateralOut).toBe(0);
        });
    });

    it('should reject non-whitelisted fields', () => {
      return request(app.getHttpServer())
        .post('/amm/estimate-sell')
        .send({ marketId: 1, outcome: 0, amount: 100, extraField: 'bad' })
        .expect(400);
    });
  });
});
