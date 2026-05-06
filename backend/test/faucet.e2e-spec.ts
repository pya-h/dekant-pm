import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { FaucetController } from '../src/faucet/faucet.controller';
import { FaucetService } from '../src/faucet/faucet.service';
import { AuthService } from '../src/auth/auth.service';
import { AuthGuard } from '../src/auth/guard/auth.guard';
import { RolesGuard } from '../src/auth/guard/roles.guard';
import { UserRoleEntity } from '../src/user/entity/user-role.entity';

const JWT_SECRET = 'e2e-test-secret-key-at-least-32-chars-long';
const TEST_SUPERADMIN = 'TestWallet1111111111111111111111111111111111';

describe('Faucet (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let faucetService: Record<string, jest.Mock>;

  function getAuthToken(wallet = TEST_SUPERADMIN): string {
    return jwtService.sign({ sub: wallet });
  }

  beforeAll(async () => {
    faucetService = {
      getStatus: jest.fn().mockResolvedValue({
        available: true,
        remainingClaims: 3,
        amountPerRequest: '1',
        label: 'SOL',
      }),
      getAllStatuses: jest.fn().mockResolvedValue([
        { token: 'native', label: 'SOL', available: true, remainingClaims: 3, amountPerRequest: '1' },
      ]),
      getAdminOverview: jest.fn().mockResolvedValue([
        {
          id: '1', token: 'native', label: 'SOL', decimals: 9,
          amountPerRequest: '1', maxRequestsPerDay: 3,
          maxDailyAmount: null, totalAmountSharable: null,
          enabled: true, walletBalance: '10', dailyDistributed: '0',
          lifetimeDistributed: '0', uniqueUsersToday: 0,
          totalClaimsToday: 0, operational: true,
        },
      ]),
      getAllConfigs: jest.fn().mockResolvedValue([
        { id: '1', token: 'native', label: 'SOL', decimals: 9, amountPerRequest: '1', maxRequestsPerDay: 3, enabled: true },
      ]),
      createConfig: jest.fn().mockImplementation((dto: any) => Promise.resolve({
        id: '2', ...dto, decimals: 9, enabled: dto.enabled ?? true, createdAt: new Date(),
      })),
      updateConfig: jest.fn().mockImplementation((id: string, dto: any) => Promise.resolve({
        id, token: 'native', label: 'SOL', decimals: 9,
        amountPerRequest: '1', maxRequestsPerDay: 3, enabled: true,
        ...dto,
      })),
      deleteConfig: jest.fn().mockResolvedValue(undefined),
      claim: jest.fn().mockResolvedValue({ txSignature: 'sig123', amount: '1' }),
    };

    process.env.SUPERADMIN_ADDRESS = TEST_SUPERADMIN;

    const roleRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        JwtModule.register({ secret: JWT_SECRET, signOptions: { expiresIn: '1h' } }),
      ],
      controllers: [FaucetController],
      providers: [
        { provide: FaucetService, useValue: faucetService },
        AuthService,
        AuthGuard,
        RolesGuard,
        { provide: getRepositoryToken(UserRoleEntity), useValue: roleRepo },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    jwtService = moduleFixture.get<JwtService>(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Public endpoints ────────────────────────────────────────────

  describe('GET /faucet/status', () => {
    it('should return faucet status for a given user and token', () => {
      return request(app.getHttpServer())
        .get('/faucet/status?address=SomeWallet&token=native')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('available');
          expect(res.body).toHaveProperty('remainingClaims');
          expect(res.body).toHaveProperty('amountPerRequest');
          expect(res.body).toHaveProperty('label');
        });
    });

    it('should call getStatus with correct params', async () => {
      await request(app.getHttpServer())
        .get('/faucet/status?address=Wallet123&token=native')
        .expect(200);

      expect(faucetService.getStatus).toHaveBeenCalledWith('Wallet123', 'native');
    });
  });

  // ── Admin endpoints ─────────────────────────────────────────────

  describe('GET /faucet/status/all', () => {
    it('should require auth', () => {
      return request(app.getHttpServer())
        .get('/faucet/status/all?address=SomeWallet')
        .expect(401);
    });

    it('should require admin role', () => {
      return request(app.getHttpServer())
        .get('/faucet/status/all?address=SomeWallet')
        .set('Authorization', `Bearer ${getAuthToken('RegularUser111111111111111111111111111111111')}`)
        .expect(403);
    });

    it('should return all statuses for superadmin', () => {
      return request(app.getHttpServer())
        .get('/faucet/status/all?address=SomeWallet')
        .set('Authorization', `Bearer ${getAuthToken()}`)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
        });
    });
  });

  describe('GET /faucet/admin/overview', () => {
    it('should require auth', () => {
      return request(app.getHttpServer())
        .get('/faucet/admin/overview')
        .expect(401);
    });

    it('should return overview for superadmin', () => {
      return request(app.getHttpServer())
        .get('/faucet/admin/overview')
        .set('Authorization', `Bearer ${getAuthToken()}`)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
          if (res.body.length > 0) {
            expect(res.body[0]).toHaveProperty('token');
            expect(res.body[0]).toHaveProperty('operational');
          }
        });
    });
  });

  describe('GET /faucet/configs', () => {
    it('should require auth', () => {
      return request(app.getHttpServer())
        .get('/faucet/configs')
        .expect(401);
    });

    it('should return configs for superadmin', () => {
      return request(app.getHttpServer())
        .get('/faucet/configs')
        .set('Authorization', `Bearer ${getAuthToken()}`)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
        });
    });
  });

  // ── Claim ───────────────────────────────────────────────────────

  describe('POST /faucet/claim', () => {
    it('should require auth', () => {
      return request(app.getHttpServer())
        .post('/faucet/claim')
        .send({ token: 'native' })
        .expect(401);
    });

    it('should claim tokens for authenticated user', () => {
      return request(app.getHttpServer())
        .post('/faucet/claim')
        .set('Authorization', `Bearer ${getAuthToken()}`)
        .send({ token: 'native' })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('txSignature');
          expect(res.body).toHaveProperty('amount');
        });
    });

    it('should pass wallet address from JWT', async () => {
      await request(app.getHttpServer())
        .post('/faucet/claim')
        .set('Authorization', `Bearer ${getAuthToken()}`)
        .send({ token: 'native' })
        .expect(201);

      expect(faucetService.claim).toHaveBeenCalledWith(TEST_SUPERADMIN, 'native');
    });

    it('should reject missing token in body', () => {
      return request(app.getHttpServer())
        .post('/faucet/claim')
        .set('Authorization', `Bearer ${getAuthToken()}`)
        .send({})
        .expect(400);
    });

    it('should reject empty token string', () => {
      return request(app.getHttpServer())
        .post('/faucet/claim')
        .set('Authorization', `Bearer ${getAuthToken()}`)
        .send({ token: '' })
        .expect(400);
    });
  });

  // ── Admin CRUD ──────────────────────────────────────────────────

  describe('POST /faucet/configs', () => {
    it('should require auth', () => {
      return request(app.getHttpServer())
        .post('/faucet/configs')
        .send({ token: 'native', amountPerRequest: '1', maxRequestsPerDay: 3 })
        .expect(401);
    });

    it('should create a config for superadmin', () => {
      return request(app.getHttpServer())
        .post('/faucet/configs')
        .set('Authorization', `Bearer ${getAuthToken()}`)
        .send({ token: 'native', amountPerRequest: '1', maxRequestsPerDay: 3 })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('token', 'native');
        });
    });

    it('should validate required fields', () => {
      return request(app.getHttpServer())
        .post('/faucet/configs')
        .set('Authorization', `Bearer ${getAuthToken()}`)
        .send({ token: 'native' }) // missing amountPerRequest, maxRequestsPerDay
        .expect(400);
    });

    it('should validate amountPerRequest format', () => {
      return request(app.getHttpServer())
        .post('/faucet/configs')
        .set('Authorization', `Bearer ${getAuthToken()}`)
        .send({ token: 'native', amountPerRequest: 'abc', maxRequestsPerDay: 3 })
        .expect(400);
    });

    it('should validate maxRequestsPerDay is positive integer', () => {
      return request(app.getHttpServer())
        .post('/faucet/configs')
        .set('Authorization', `Bearer ${getAuthToken()}`)
        .send({ token: 'native', amountPerRequest: '1', maxRequestsPerDay: 0 })
        .expect(400);
    });
  });

  describe('PATCH /faucet/configs/:id', () => {
    it('should require auth', () => {
      return request(app.getHttpServer())
        .patch('/faucet/configs/1')
        .send({ enabled: false })
        .expect(401);
    });

    it('should update config for superadmin', () => {
      return request(app.getHttpServer())
        .patch('/faucet/configs/1')
        .set('Authorization', `Bearer ${getAuthToken()}`)
        .send({ enabled: false })
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('enabled', false);
        });
    });

    it('should validate amountPerRequest format if provided', () => {
      return request(app.getHttpServer())
        .patch('/faucet/configs/1')
        .set('Authorization', `Bearer ${getAuthToken()}`)
        .send({ amountPerRequest: 'not-a-number' })
        .expect(400);
    });
  });

  describe('DELETE /faucet/configs/:id', () => {
    it('should require auth', () => {
      return request(app.getHttpServer())
        .delete('/faucet/configs/1')
        .expect(401);
    });

    it('should delete config for superadmin', () => {
      return request(app.getHttpServer())
        .delete('/faucet/configs/1')
        .set('Authorization', `Bearer ${getAuthToken()}`)
        .expect(200);
    });
  });
});
