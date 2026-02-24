import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { HealthModule } from '../src/health/health.module';
import { AuthService } from '../src/auth/auth.service';
import { AuthController } from '../src/auth/auth.controller';
import { AuthGuard } from '../src/auth/guard/auth.guard';
import { MarketService } from '../src/market/market.service';
import { MarketController } from '../src/market/market.controller';
import { AmmService } from '../src/amm/amm.service';
import { AmmController } from '../src/amm/amm.controller';
import { UserService } from '../src/user/user.service';
import { UserController, AdminController } from '../src/user/user.controller';
import { MarketEntity } from '../src/market/entity/market.entity';
import { TradeEntity } from '../src/market/entity/trade.entity';
import { UserPositionEntity } from '../src/user/entity/user-position.entity';
import { LpPositionEntity } from '../src/user/entity/lp-position.entity';
import { UserRoleEntity } from '../src/user/entity/user-role.entity';

const JWT_SECRET = 'e2e-test-secret-key-at-least-32-chars-long';

function mockMarket(overrides: Partial<MarketEntity> = {}): MarketEntity {
  return {
    id: '1',
    pubkey: 'MarketPk11111111111111111111111111111111111',
    marketType: 0,
    state: 0,
    creator: 'Creator1111111111111111111111111111111111111',
    oracle: 'Oracle11111111111111111111111111111111111111',
    collateralMint: 'Mint1111111111111111111111111111111111111111',
    deadline: new Date('2026-12-31'),
    createdAt: new Date('2025-01-01'),
    resolvedAt: null,
    numOutcomes: 2,
    title: 'Test Market',
    description: null,
    category: 'crypto',
    tags: null,
    imageUrl: null,
    outcomeLabels: ['Yes', 'No'],
    reserves: ['500000000', '500000000'],
    kSquared: '500000000000000000',
    totalMinted: '1000000000',
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

describe('App (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let marketRepo: Record<string, jest.Mock>;
  let tradeRepo: Record<string, jest.Mock>;
  let positionRepo: Record<string, jest.Mock>;
  let lpPositionRepo: Record<string, jest.Mock>;
  let roleRepo: Record<string, jest.Mock>;

  beforeAll(async () => {
    const qbMock = {
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[mockMarket()], 1]),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    marketRepo = {
      create: jest.fn((dto) => dto),
      save: jest.fn((entity) => Promise.resolve({ ...entity, id: entity.id ?? '1' })),
      findOne: jest.fn().mockResolvedValue(mockMarket()),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn().mockReturnValue(qbMock),
    };

    tradeRepo = {
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    };

    positionRepo = {
      find: jest.fn().mockResolvedValue([]),
    };

    lpPositionRepo = {
      find: jest.fn().mockResolvedValue([]),
    };

    roleRepo = {
      find: jest.fn().mockResolvedValue([]),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        JwtModule.register({
          secret: JWT_SECRET,
          signOptions: { expiresIn: '1h' },
        }),
        HealthModule,
      ],
      controllers: [
        AuthController,
        MarketController,
        AmmController,
        UserController,
        AdminController,
      ],
      providers: [
        AuthService,
        AuthGuard,
        MarketService,
        AmmService,
        UserService,
        { provide: getRepositoryToken(MarketEntity), useValue: marketRepo },
        { provide: getRepositoryToken(TradeEntity), useValue: tradeRepo },
        { provide: getRepositoryToken(UserPositionEntity), useValue: positionRepo },
        { provide: getRepositoryToken(LpPositionEntity), useValue: lpPositionRepo },
        { provide: getRepositoryToken(UserRoleEntity), useValue: roleRepo },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    jwtService = moduleFixture.get<JwtService>(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  function getAuthToken(wallet = 'TestWallet1111111111111111111111111111111111'): string {
    return jwtService.sign({ sub: wallet });
  }

  // ─── Health ──────────────────────────────────────────────

  describe('GET /health', () => {
    it('should return ok status', () => {
      return request(app.getHttpServer())
        .get('/health')
        .expect(200)
        .expect({ status: 'ok' });
    });
  });

  // ─── Auth ────────────────────────────────────────────────

  describe('POST /auth/challenge', () => {
    it('should create a challenge for a valid wallet', () => {
      return request(app.getHttpServer())
        .post('/auth/challenge')
        .send({ walletAddress: '11111111111111111111111111111111' })
        .expect(201)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('nonce');
          expect(res.body).toHaveProperty('message');
          expect(typeof res.body.nonce).toBe('string');
        });
    });

    it('should reject empty walletAddress', () => {
      return request(app.getHttpServer())
        .post('/auth/challenge')
        .send({ walletAddress: '' })
        .expect(400);
    });

    it('should reject missing walletAddress', () => {
      return request(app.getHttpServer())
        .post('/auth/challenge')
        .send({})
        .expect(400);
    });

    it('should reject non-whitelisted fields', () => {
      return request(app.getHttpServer())
        .post('/auth/challenge')
        .send({ walletAddress: '11111111111111111111111111111111', extra: 'bad' })
        .expect(400);
    });
  });

  describe('POST /auth/verify', () => {
    it('should reject verify without a pending challenge', () => {
      return request(app.getHttpServer())
        .post('/auth/verify')
        .send({
          walletAddress: '11111111111111111111111111111111',
          signature: 'badsig',
          nonce: 'badnonce',
        })
        .expect(401);
    });

    it('should reject missing fields', () => {
      return request(app.getHttpServer())
        .post('/auth/verify')
        .send({ walletAddress: '11111111111111111111111111111111' })
        .expect(400);
    });
  });

  // ─── Markets ─────────────────────────────────────────────

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

    it('should reject invalid page param', () => {
      return request(app.getHttpServer())
        .get('/markets?page=0')
        .expect(400);
    });

    it('should reject limit above 100', () => {
      return request(app.getHttpServer())
        .get('/markets?limit=200')
        .expect(400);
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
      marketRepo.findOne.mockResolvedValueOnce(null);
      return request(app.getHttpServer())
        .get('/markets/999')
        .expect(404);
    });

    it('should reject non-numeric ID', () => {
      return request(app.getHttpServer())
        .get('/markets/abc')
        .expect(400);
    });
  });

  describe('GET /markets/:id/prices', () => {
    it('should return probabilities array', () => {
      marketRepo.findOne.mockResolvedValueOnce(mockMarket());
      return request(app.getHttpServer())
        .get('/markets/1/prices')
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('probabilities');
          expect(Array.isArray(res.body.probabilities)).toBe(true);
        });
    });

    it('should return uniform probabilities when kSquared is 0', () => {
      marketRepo.findOne.mockResolvedValueOnce(
        mockMarket({ reserves: ['0', '0'], kSquared: '0', totalMinted: '0' }),
      );
      return request(app.getHttpServer())
        .get('/markets/1/prices')
        .expect(200)
        .expect((res: any) => {
          expect(res.body.probabilities[0]).toBeCloseTo(0.5);
          expect(res.body.probabilities[1]).toBeCloseTo(0.5);
        });
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
  });

  describe('POST /markets', () => {
    const validDto = {
      title: 'Will ETH hit $10k?',
      marketId: 42,
      pubkey: 'Pubkey11111111111111111111111111111111111111',
      marketType: 0,
      numOutcomes: 2,
      creator: 'Creator1111111111111111111111111111111111111',
      oracle: 'Oracle11111111111111111111111111111111111111',
      collateralMint: 'Mint1111111111111111111111111111111111111111',
      deadline: '2026-12-31T00:00:00Z',
    };

    it('should require authentication', () => {
      return request(app.getHttpServer())
        .post('/markets')
        .send(validDto)
        .expect(401);
    });

    it('should create a market when authenticated', () => {
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${getAuthToken()}`)
        .send(validDto)
        .expect(201);
    });

    it('should reject missing required fields', () => {
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${getAuthToken()}`)
        .send({ title: 'Incomplete' })
        .expect(400);
    });

    it('should reject invalid marketType', () => {
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${getAuthToken()}`)
        .send({ ...validDto, marketType: 5 })
        .expect(400);
    });

    it('should reject numOutcomes below 2', () => {
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${getAuthToken()}`)
        .send({ ...validDto, numOutcomes: 1 })
        .expect(400);
    });

    it('should reject non-whitelisted fields', () => {
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${getAuthToken()}`)
        .send({ ...validDto, hackerField: 'pwned' })
        .expect(400);
    });

    it('should reject invalid JWT', () => {
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', 'Bearer invalid.jwt.token')
        .send(validDto)
        .expect(401);
    });
  });

  // ─── AMM ─────────────────────────────────────────────────

  describe('POST /amm/estimate-buy', () => {
    it('should return buy estimate for discrete market', () => {
      marketRepo.findOne.mockResolvedValueOnce(mockMarket());
      return request(app.getHttpServer())
        .post('/amm/estimate-buy')
        .send({ marketId: 1, outcome: 0, amount: 1000 })
        .expect(201)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('tokensOut');
          expect(res.body).toHaveProperty('fee');
          expect(res.body).toHaveProperty('newProbabilities');
          expect(typeof res.body.tokensOut).toBe('number');
        });
    });

    it('should return distribution buy for continuous market', () => {
      marketRepo.findOne.mockResolvedValueOnce(
        mockMarket({
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
  });

  describe('POST /amm/estimate-sell', () => {
    it('should return sell estimate', () => {
      marketRepo.findOne.mockResolvedValueOnce(
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
        });
    });

    it('should reject missing fields', () => {
      return request(app.getHttpServer())
        .post('/amm/estimate-sell')
        .send({ marketId: 1 })
        .expect(400);
    });
  });

  // ─── Users ───────────────────────────────────────────────

  describe('GET /users/:address/positions', () => {
    it('should return positions for a wallet', () => {
      positionRepo.find.mockResolvedValueOnce([]);
      return request(app.getHttpServer())
        .get('/users/SomeWallet111111111111111111111111111111111/positions')
        .expect(200)
        .expect((res: any) => {
          expect(Array.isArray(res.body)).toBe(true);
        });
    });
  });

  describe('GET /users/:address/history', () => {
    it('should return paginated trade history', () => {
      tradeRepo.findAndCount.mockResolvedValueOnce([[], 0]);
      return request(app.getHttpServer())
        .get('/users/SomeWallet111111111111111111111111111111111/history')
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('data');
          expect(res.body).toHaveProperty('total');
        });
    });

    it('should respect pagination params', () => {
      tradeRepo.findAndCount.mockResolvedValueOnce([[], 0]);
      return request(app.getHttpServer())
        .get('/users/SomeWallet111111111111111111111111111111111/history?page=2&limit=10')
        .expect(200);
    });
  });

  describe('GET /users/:address/lp-positions', () => {
    it('should return LP positions for a wallet', () => {
      lpPositionRepo.find.mockResolvedValueOnce([]);
      return request(app.getHttpServer())
        .get('/users/SomeWallet111111111111111111111111111111111/lp-positions')
        .expect(200)
        .expect((res: any) => {
          expect(Array.isArray(res.body)).toBe(true);
        });
    });
  });

  // ─── Admin ───────────────────────────────────────────────

  describe('GET /admin/roles', () => {
    it('should require authentication', () => {
      return request(app.getHttpServer())
        .get('/admin/roles')
        .expect(401);
    });

    it('should return roles when authenticated', () => {
      roleRepo.find.mockResolvedValueOnce([]);
      return request(app.getHttpServer())
        .get('/admin/roles')
        .set('Authorization', `Bearer ${getAuthToken()}`)
        .expect(200)
        .expect((res: any) => {
          expect(Array.isArray(res.body)).toBe(true);
        });
    });
  });

  describe('GET /admin/markets/stale', () => {
    it('should require authentication', () => {
      return request(app.getHttpServer())
        .get('/admin/markets/stale')
        .expect(401);
    });

    it('should return stale markets when authenticated', () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      marketRepo.createQueryBuilder.mockReturnValueOnce(qb);

      return request(app.getHttpServer())
        .get('/admin/markets/stale')
        .set('Authorization', `Bearer ${getAuthToken()}`)
        .expect(200)
        .expect((res: any) => {
          expect(Array.isArray(res.body)).toBe(true);
        });
    });

    it('should accept custom days param', () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      marketRepo.createQueryBuilder.mockReturnValueOnce(qb);

      return request(app.getHttpServer())
        .get('/admin/markets/stale?days=14')
        .set('Authorization', `Bearer ${getAuthToken()}`)
        .expect(200);
    });
  });

  // ─── 404 for unknown routes ──────────────────────────────

  describe('Unknown routes', () => {
    it('should return 404 for unknown paths', () => {
      return request(app.getHttpServer())
        .get('/nonexistent')
        .expect(404);
    });
  });
});
