import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { createTestApp, TestApp } from './helpers/test-app';
import { mockMarket, mockTrade, randomWallet } from './helpers/mock-factories';

describe('Users & Admin (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
    ({ app, jwtService } = testApp);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /users/:address/positions', () => {
    it('should return empty array for unknown wallet', () => {
      testApp.positionRepo.find.mockResolvedValueOnce([]);
      return request(app.getHttpServer())
        .get(`/users/${randomWallet()}/positions`)
        .expect(200)
        .expect((res: any) => {
          expect(Array.isArray(res.body)).toBe(true);
          expect(res.body).toHaveLength(0);
        });
    });

    it('should return positions when present', () => {
      testApp.positionRepo.find.mockResolvedValueOnce([
        {
          id: '1',
          marketId: '1',
          userAddress: 'Wallet1',
          holdings: ['100', '50'],
          totalDeposited: '200',
          totalWithdrawn: '0',
          claimed: false,
          updatedAt: new Date(),
        },
        {
          id: '2',
          marketId: '2',
          userAddress: 'Wallet1',
          holdings: ['300'],
          totalDeposited: '400',
          totalWithdrawn: '100',
          claimed: false,
          updatedAt: new Date(),
        },
      ]);
      return request(app.getHttpServer())
        .get('/users/Wallet1/positions')
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveLength(2);
          expect(res.body[0]).toHaveProperty('holdings');
        });
    });
  });

  describe('GET /users/:address/history', () => {
    it('should return empty paginated result for unknown wallet', () => {
      testApp.tradeRepo.findAndCount.mockResolvedValueOnce([[], 0]);
      return request(app.getHttpServer())
        .get(`/users/${randomWallet()}/history`)
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('data');
          expect(res.body).toHaveProperty('total');
          expect(res.body.data).toHaveLength(0);
          expect(res.body.total).toBe(0);
        });
    });

    it('should return trades when present', () => {
      const trades = [mockTrade(), mockTrade({ id: '2' })];
      testApp.tradeRepo.findAndCount.mockResolvedValueOnce([trades, 2]);
      return request(app.getHttpServer())
        .get(`/users/${randomWallet()}/history`)
        .expect(200)
        .expect((res: any) => {
          expect(res.body.data).toHaveLength(2);
          expect(res.body.total).toBe(2);
        });
    });

    it('should respect pagination params', () => {
      testApp.tradeRepo.findAndCount.mockResolvedValueOnce([[], 0]);
      return request(app.getHttpServer())
        .get(`/users/${randomWallet()}/history?page=2&limit=10`)
        .expect(200);
    });

    it('should clamp negative page to 1', () => {
      testApp.tradeRepo.findAndCount.mockResolvedValueOnce([[], 0]);
      return request(app.getHttpServer())
        .get(`/users/${randomWallet()}/history?page=-5`)
        .expect(200);
    });

    it('should clamp limit above 100 to 100', () => {
      testApp.tradeRepo.findAndCount.mockResolvedValueOnce([[], 0]);
      return request(app.getHttpServer())
        .get(`/users/${randomWallet()}/history?limit=500`)
        .expect(200);
    });
  });

  describe('GET /users/:address/lp-positions', () => {
    it('should return empty array for unknown wallet', () => {
      testApp.lpPositionRepo.find.mockResolvedValueOnce([]);
      return request(app.getHttpServer())
        .get(`/users/${randomWallet()}/lp-positions`)
        .expect(200)
        .expect((res: any) => {
          expect(Array.isArray(res.body)).toBe(true);
          expect(res.body).toHaveLength(0);
        });
    });

    it('should return LP positions when present', () => {
      testApp.lpPositionRepo.find.mockResolvedValueOnce([
        {
          id: '1',
          marketId: '1',
          userAddress: 'LPWallet1',
          shares: '500000',
          depositedCollateral: '1000000',
          updatedAt: new Date(),
        },
      ]);
      return request(app.getHttpServer())
        .get('/users/LPWallet1/lp-positions')
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveLength(1);
          expect(res.body[0]).toHaveProperty('shares');
          expect(res.body[0]).toHaveProperty('depositedCollateral');
        });
    });
  });

  describe('GET /admin/roles', () => {
    it('should require authentication', () => {
      return request(app.getHttpServer()).get('/admin/roles').expect(401);
    });

    it('should return empty array when no roles', () => {
      testApp.roleRepo.find.mockResolvedValueOnce([]);
      return request(app.getHttpServer())
        .get('/admin/roles')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .expect(200)
        .expect((res: any) => {
          expect(Array.isArray(res.body)).toBe(true);
          expect(res.body).toHaveLength(0);
        });
    });

    it('should return roles when present', () => {
      testApp.roleRepo.find.mockResolvedValueOnce([
        {
          id: '1',
          userAddress: randomWallet(),
          role: 2,
          assignedBy: randomWallet(),
          assignedAt: new Date(),
        },
        {
          id: '2',
          userAddress: randomWallet(),
          role: 1,
          assignedBy: randomWallet(),
          assignedAt: new Date(),
        },
      ]);
      return request(app.getHttpServer())
        .get('/admin/roles')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveLength(2);
          expect(res.body[0]).toHaveProperty('role');
          expect(res.body[0]).toHaveProperty('userAddress');
        });
    });

    it('should reject expired token', () => {
      const expiredToken = jwtService.sign(
        { sub: 'TestWallet' },
        { expiresIn: '0s' },
      );
      return new Promise((resolve) => setTimeout(resolve, 50)).then(() =>
        request(app.getHttpServer())
          .get('/admin/roles')
          .set('Authorization', `Bearer ${expiredToken}`)
          .expect(401),
      );
    });

    it('should reject malformed token', () => {
      return request(app.getHttpServer())
        .get('/admin/roles')
        .set('Authorization', 'Bearer garbage-token')
        .expect(401);
    });

    it('should reject Basic auth scheme', () => {
      return request(app.getHttpServer())
        .get('/admin/roles')
        .set('Authorization', 'Basic dXNlcjpwYXNz')
        .expect(401);
    });
  });

  describe('GET /admin/markets/stale', () => {
    it('should require authentication', () => {
      return request(app.getHttpServer())
        .get('/admin/markets/stale')
        .expect(401);
    });

    it('should return empty array when no stale markets', () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      testApp.marketRepo.createQueryBuilder.mockReturnValueOnce(qb);

      return request(app.getHttpServer())
        .get('/admin/markets/stale')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .expect(200)
        .expect((res: any) => {
          expect(Array.isArray(res.body)).toBe(true);
          expect(res.body).toHaveLength(0);
        });
    });

    it('should return stale markets when present', () => {
      const staleMarkets = [
        mockMarket({ id: '10', state: 2, title: 'Stale market' }),
      ];
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(staleMarkets),
      };
      testApp.marketRepo.createQueryBuilder.mockReturnValueOnce(qb);

      return request(app.getHttpServer())
        .get('/admin/markets/stale')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveLength(1);
          expect(res.body[0]).toHaveProperty('title', 'Stale market');
        });
    });

    it('should accept custom days param', () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      testApp.marketRepo.createQueryBuilder.mockReturnValueOnce(qb);

      return request(app.getHttpServer())
        .get('/admin/markets/stale?days=14')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .expect(200);
    });

    it('should accept days=1', () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      testApp.marketRepo.createQueryBuilder.mockReturnValueOnce(qb);

      return request(app.getHttpServer())
        .get('/admin/markets/stale?days=1')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .expect(200);
    });

    it('should reject expired token', () => {
      const expiredToken = jwtService.sign(
        { sub: 'TestWallet' },
        { expiresIn: '0s' },
      );
      return new Promise((resolve) => setTimeout(resolve, 50)).then(() =>
        request(app.getHttpServer())
          .get('/admin/markets/stale')
          .set('Authorization', `Bearer ${expiredToken}`)
          .expect(401),
      );
    });
  });
});
