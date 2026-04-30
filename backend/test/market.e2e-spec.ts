import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, TestApp } from './helpers/test-app';
import {
  mockMarket,
  mockTrade,
  randomWallet,
  randomAmount,
  randomString,
  validCreateDto,
} from './helpers/mock-factories';

describe('Markets (e2e)', () => {
  let app: INestApplication;
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
    app = testApp.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /markets', () => {
    it('should return paginated market list', () => {
      return request(app.getHttpServer())
        .get('/markets')
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('data');
          expect(res.body).toHaveProperty('total');
          expect(Array.isArray(res.body.data)).toBe(true);
        });
    });

    it('should accept filter query params', () => {
      return request(app.getHttpServer())
        .get('/markets?category=crypto&state=0&marketType=0&page=1&limit=10')
        .expect(200);
    });

    it('should reject invalid page param (page=0)', () => {
      return request(app.getHttpServer())
        .get('/markets?page=0')
        .expect(400);
    });

    it('should reject negative page', () => {
      return request(app.getHttpServer())
        .get('/markets?page=-1')
        .expect(400);
    });

    it('should reject limit above 100', () => {
      return request(app.getHttpServer())
        .get('/markets?limit=200')
        .expect(400);
    });

    it('should reject limit of 0', () => {
      return request(app.getHttpServer())
        .get('/markets?limit=0')
        .expect(400);
    });

    it('should reject negative limit', () => {
      return request(app.getHttpServer())
        .get('/markets?limit=-5')
        .expect(400);
    });

    it('should accept sortBy=deadline', () => {
      return request(app.getHttpServer())
        .get('/markets?sortBy=deadline')
        .expect(200);
    });

    it('should accept sortBy=volume', () => {
      return request(app.getHttpServer())
        .get('/markets?sortBy=volume')
        .expect(200);
    });

    it('should accept sortBy=newest (default)', () => {
      return request(app.getHttpServer())
        .get('/markets?sortBy=newest')
        .expect(200);
    });

    it('should accept search parameter', () => {
      return request(app.getHttpServer())
        .get(`/markets?search=${randomString(6)}`)
        .expect(200);
    });

    it('should handle search with SQL special characters safely', () => {
      return request(app.getHttpServer())
        .get('/markets?search=%25drop%20table')
        .expect(200);
    });

    it('should handle search with underscore wildcard safely', () => {
      return request(app.getHttpServer())
        .get('/markets?search=test_market')
        .expect(200);
    });

    it('should handle search with backslash safely', () => {
      return request(app.getHttpServer())
        .get('/markets?search=test\\value')
        .expect(200);
    });

    it('should accept creator filter param', () => {
      return request(app.getHttpServer())
        .get(`/markets?creator=${randomWallet()}`)
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('data');
          expect(res.body).toHaveProperty('total');
        });
    });

    it('should return stats when includeStats=true', () => {
      return request(app.getHttpServer())
        .get(`/markets?creator=${randomWallet()}&includeStats=true`)
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('stats');
          expect(res.body.stats).toHaveProperty('totalVolume');
          expect(res.body.stats).toHaveProperty('totalTraders');
        });
    });

    it('should not return stats when includeStats is not set', () => {
      return request(app.getHttpServer())
        .get('/markets')
        .expect(200)
        .expect((res: any) => {
          expect(res.body).not.toHaveProperty('stats');
        });
    });

    it('should accept combined filters', () => {
      return request(app.getHttpServer())
        .get(
          '/markets?category=crypto&state=0&marketType=0&search=ETH&sortBy=volume&page=1&limit=10',
        )
        .expect(200);
    });

    it('should accept limit=1 (minimum)', () => {
      return request(app.getHttpServer())
        .get('/markets?limit=1')
        .expect(200);
    });

    it('should accept limit=100 (maximum)', () => {
      return request(app.getHttpServer())
        .get('/markets?limit=100')
        .expect(200);
    });

    it('should accept large page number', () => {
      return request(app.getHttpServer())
        .get('/markets?page=9999')
        .expect(200);
    });
  });

  describe('GET /markets/:id', () => {
    it('should return a market by ID', () => {
      return request(app.getHttpServer())
        .get('/markets/1')
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('id');
          expect(res.body).toHaveProperty('title');
          expect(res.body).toHaveProperty('reserves');
        });
    });

    it('should return 404 for non-existent market', () => {
      testApp.marketRepo.findOne.mockResolvedValueOnce(null);
      return request(app.getHttpServer()).get('/markets/999').expect(404);
    });

    it('should reject non-numeric ID', () => {
      return request(app.getHttpServer()).get('/markets/abc').expect(400);
    });

    it('should reject negative ID (ParseIntPipe accepts it, service handles)', () => {
      testApp.marketRepo.findOne.mockResolvedValueOnce(null);
      return request(app.getHttpServer()).get('/markets/-1').expect(404);
    });

    it('should handle zero ID', () => {
      testApp.marketRepo.findOne.mockResolvedValueOnce(null);
      return request(app.getHttpServer()).get('/markets/0').expect(404);
    });
  });

  describe('GET /markets/:id/prices', () => {
    it('should return probabilities array', () => {
      testApp.marketRepo.findOne.mockResolvedValueOnce(mockMarket());
      return request(app.getHttpServer())
        .get('/markets/1/prices')
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('probabilities');
          expect(Array.isArray(res.body.probabilities)).toBe(true);
          expect(res.body.probabilities).toHaveLength(2);
        });
    });

    it('should return uniform probabilities when kSquared is 0', () => {
      testApp.marketRepo.findOne.mockResolvedValueOnce(
        mockMarket({
          reserves: ['0', '0'],
          kSquared: '0',
          totalMinted: '0',
        }),
      );
      return request(app.getHttpServer())
        .get('/markets/1/prices')
        .expect(200)
        .expect((res: any) => {
          expect(res.body.probabilities[0]).toBeCloseTo(0.5);
          expect(res.body.probabilities[1]).toBeCloseTo(0.5);
        });
    });

    it('should return probabilities that reflect reserve imbalance', () => {
      testApp.marketRepo.findOne.mockResolvedValueOnce(
        mockMarket({
          reserves: ['200000000', '800000000'],
          totalMinted: '1000000000',
          kSquared: '640000000000000000',
        }),
      );
      return request(app.getHttpServer())
        .get('/markets/1/prices')
        .expect(200)
        .expect((res: any) => {
          // x0 = 1B - 200M = 800M, x1 = 1B - 800M = 200M → p0 > p1
          expect(res.body.probabilities[0]).toBeGreaterThan(
            res.body.probabilities[1],
          );
        });
    });

    it('should return equal probabilities for equal reserves', () => {
      testApp.marketRepo.findOne.mockResolvedValueOnce(
        mockMarket({
          reserves: ['500000000', '500000000'],
          totalMinted: '1000000000',
          kSquared: '500000000000000000',
        }),
      );
      return request(app.getHttpServer())
        .get('/markets/1/prices')
        .expect(200)
        .expect((res: any) => {
          expect(res.body.probabilities[0]).toBeCloseTo(
            res.body.probabilities[1],
          );
        });
    });

    it('should handle multi-outcome market prices', () => {
      testApp.marketRepo.findOne.mockResolvedValueOnce(
        mockMarket({
          numOutcomes: 3,
          reserves: ['300', '300', '300'],
          totalMinted: '900',
          // sum of (900-300)^2 = 3 * 360000
          kSquared: '1080000',
        }),
      );
      return request(app.getHttpServer())
        .get('/markets/1/prices')
        .expect(200)
        .expect((res: any) => {
          expect(res.body.probabilities).toHaveLength(3);
          const p0 = res.body.probabilities[0];
          expect(res.body.probabilities[1]).toBeCloseTo(p0);
          expect(res.body.probabilities[2]).toBeCloseTo(p0);
        });
    });

    it('should return 404 for non-existent market prices', () => {
      testApp.marketRepo.findOne.mockResolvedValueOnce(null);
      return request(app.getHttpServer())
        .get('/markets/999/prices')
        .expect(404);
    });
  });

  describe('GET /markets/:id/history', () => {
    it('should return paginated trade history', () => {
      return request(app.getHttpServer())
        .get('/markets/1/history')
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('data');
          expect(res.body).toHaveProperty('total');
        });
    });

    it('should respect pagination params', () => {
      return request(app.getHttpServer())
        .get('/markets/1/history?page=2&limit=10')
        .expect(200);
    });

    it('should return trades when present', () => {
      const trades = [
        mockTrade({ id: '1', timestamp: new Date('2025-06-02') }),
        mockTrade({ id: '2', timestamp: new Date('2025-06-01') }),
      ];
      testApp.tradeRepo.findAndCount.mockResolvedValueOnce([trades, 2]);
      return request(app.getHttpServer())
        .get('/markets/1/history')
        .expect(200)
        .expect((res: any) => {
          expect(res.body.data).toHaveLength(2);
          expect(res.body.total).toBe(2);
        });
    });

    it('should clamp negative page to 1', () => {
      return request(app.getHttpServer())
        .get('/markets/1/history?page=-5')
        .expect(200);
    });

    it('should clamp limit to max 100', () => {
      return request(app.getHttpServer())
        .get('/markets/1/history?limit=500')
        .expect(200);
    });
  });

  describe('POST /markets', () => {
    it('should require authentication', () => {
      return request(app.getHttpServer())
        .post('/markets')
        .send(validCreateDto())
        .expect(401);
    });

    it('should create a market when authenticated', () => {
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .send(validCreateDto())
        .expect(201);
    });

    it('should reject missing required fields', () => {
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .send({ title: 'Incomplete' })
        .expect(400);
    });

    it('should reject invalid marketType (above max)', () => {
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .send(validCreateDto({ marketType: 5 }))
        .expect(400);
    });

    it('should reject invalid marketType (negative)', () => {
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .send(validCreateDto({ marketType: -1 }))
        .expect(400);
    });

    it('should accept marketType=0 (binary)', () => {
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .send(validCreateDto({ marketType: 0 }))
        .expect(201);
    });

    it('should accept marketType=1 (multi)', () => {
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .send(validCreateDto({ marketType: 1 }))
        .expect(201);
    });

    it('should accept marketType=2 (continuous)', () => {
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .send(validCreateDto({ marketType: 2 }))
        .expect(201);
    });

    it('should reject numOutcomes below 2', () => {
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .send(validCreateDto({ numOutcomes: 1 }))
        .expect(400);
    });

    it('should reject numOutcomes above 256', () => {
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .send(validCreateDto({ numOutcomes: 257 }))
        .expect(400);
    });

    it('should accept numOutcomes=2 (minimum)', () => {
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .send(validCreateDto({ numOutcomes: 2 }))
        .expect(201);
    });

    it('should accept numOutcomes=256 (maximum)', () => {
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .send(validCreateDto({ numOutcomes: 256 }))
        .expect(201);
    });

    it('should reject non-whitelisted fields', () => {
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .send(validCreateDto({ hackerField: 'pwned' }))
        .expect(400);
    });

    it('should reject invalid JWT', () => {
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', 'Bearer invalid.jwt.token')
        .send(validCreateDto())
        .expect(401);
    });

    it('should accept optional fields', () => {
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .send(
          validCreateDto({
            description: `Description ${randomString(12)}`,
            category: 'politics',
            tags: ['election', '2026'],
            imageUrl: 'https://example.com/img.png',
            outcomeLabels: ['Yes', 'No'],
          }),
        )
        .expect(201);
    });

    it('should accept continuous market with range params', () => {
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .send(
          validCreateDto({
            marketType: 2,
            numOutcomes: 10,
            rangeMin: 0,
            rangeMax: 100,
          }),
        )
        .expect(201);
    });

    it('should reject non-string tags array items', () => {
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .send(validCreateDto({ tags: [123, 456] }))
        .expect(400);
    });

    it('should reject non-array tags', () => {
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .send(validCreateDto({ tags: 'not-an-array' }))
        .expect(400);
    });

    it('should reject empty title', () => {
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .send(validCreateDto({ title: '' }))
        .expect(400);
    });

    it('should reject empty body', () => {
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .send({})
        .expect(400);
    });
  });
});
