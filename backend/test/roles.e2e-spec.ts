import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, TestApp, TEST_SUPERADMIN } from './helpers/test-app';
import { validCreateDto, randomWallet } from './helpers/mock-factories';

/**
 * B-13: Role-Based Authorization e2e tests.
 *
 * Tests the full RBAC matrix across all protected and public endpoints.
 *
 * Caller types:
 *  - noToken:     no Authorization header         → 401
 *  - noRole:      valid JWT, no role in DB         → 403
 *  - adminRole:   valid JWT, Admin role (1)        → allowed on admin+, denied on superadmin
 *  - superadmin:  JWT for SUPERADMIN_ADDRESS       → allowed everywhere
 */
describe('Roles (e2e)', () => {
  let app: INestApplication;
  let testApp: TestApp;

  // Tokens for different caller types
  let superadminToken: string;
  let adminToken: string;
  let oracleToken: string;
  let noRoleToken: string;

  const adminWallet = 'AdminWallet11111111111111111111111111111111111';
  const oracleWallet = 'OracleWallet1111111111111111111111111111111111';
  const noRoleWallet = 'NoRoleWallet1111111111111111111111111111111111';

  beforeAll(async () => {
    testApp = await createTestApp();
    app = testApp.app;

    superadminToken = testApp.getAuthToken(TEST_SUPERADMIN);
    adminToken = testApp.getAuthToken(adminWallet);
    oracleToken = testApp.getAuthToken(oracleWallet);
    noRoleToken = testApp.getAuthToken(noRoleWallet);
  });

  afterAll(async () => {
    await app.close();
  });

  // Helper: mock roleRepo.find for a specific call to return given roles
  function mockRoles(roles: Array<{ role: number }>) {
    testApp.roleRepo.find.mockResolvedValueOnce(roles);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 1. Settings endpoints — @Roles('superadmin')
  // ═══════════════════════════════════════════════════════════════════

  describe('Settings endpoints (superadmin only)', () => {
    const activeRow = {
      id: 1, name: 'default', isActive: true,
      feeCollectInterval: 'none', deadlineCheckInterval: '1m',
    };

    // ── GET /settings ─────────────────────────────────────────────
    describe('GET /settings', () => {
      it('401 — no token', () =>
        request(app.getHttpServer()).get('/settings').expect(401));

      it('403 — valid JWT, no role', () => {
        mockRoles([]);
        return request(app.getHttpServer())
          .get('/settings')
          .set('Authorization', `Bearer ${noRoleToken}`)
          .expect(403);
      });

      it('403 — valid JWT, admin role', () => {
        mockRoles([{ role: 1 }]);
        return request(app.getHttpServer())
          .get('/settings')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(403);
      });

      it('200 — superadmin', () => {
        testApp.settingRepo.findOne.mockResolvedValueOnce(null);
        return request(app.getHttpServer())
          .get('/settings')
          .set('Authorization', `Bearer ${superadminToken}`)
          .expect(200);
      });
    });

    // ── GET /settings/all ─────────────────────────────────────────
    describe('GET /settings/all', () => {
      it('401 — no token', () =>
        request(app.getHttpServer()).get('/settings/all').expect(401));

      it('403 — valid JWT, no role', () => {
        mockRoles([]);
        return request(app.getHttpServer())
          .get('/settings/all')
          .set('Authorization', `Bearer ${noRoleToken}`)
          .expect(403);
      });

      it('403 — valid JWT, admin role', () => {
        mockRoles([{ role: 1 }]);
        return request(app.getHttpServer())
          .get('/settings/all')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(403);
      });

      it('200 — superadmin', () => {
        testApp.settingRepo.find.mockResolvedValueOnce([activeRow]);
        return request(app.getHttpServer())
          .get('/settings/all')
          .set('Authorization', `Bearer ${superadminToken}`)
          .expect(200);
      });
    });

    // ── POST /settings ────────────────────────────────────────────
    describe('POST /settings', () => {
      it('401 — no token', () =>
        request(app.getHttpServer())
          .post('/settings').send({ name: 'x' }).expect(401));

      it('403 — valid JWT, no role', () => {
        mockRoles([]);
        return request(app.getHttpServer())
          .post('/settings')
          .set('Authorization', `Bearer ${noRoleToken}`)
          .send({ name: 'x' })
          .expect(403);
      });

      it('403 — valid JWT, admin role', () => {
        mockRoles([{ role: 1 }]);
        return request(app.getHttpServer())
          .post('/settings')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ name: 'x' })
          .expect(403);
      });

      it('201 — superadmin', () =>
        request(app.getHttpServer())
          .post('/settings')
          .set('Authorization', `Bearer ${superadminToken}`)
          .send({ name: 'new-preset' })
          .expect(201));
    });

    // ── PATCH /settings ───────────────────────────────────────────
    describe('PATCH /settings', () => {
      it('401 — no token', () =>
        request(app.getHttpServer())
          .patch('/settings').send({ feeCollectInterval: '6h' }).expect(401));

      it('403 — valid JWT, no role', () => {
        mockRoles([]);
        return request(app.getHttpServer())
          .patch('/settings')
          .set('Authorization', `Bearer ${noRoleToken}`)
          .send({ feeCollectInterval: '6h' })
          .expect(403);
      });

      it('403 — valid JWT, admin role', () => {
        mockRoles([{ role: 1 }]);
        return request(app.getHttpServer())
          .patch('/settings')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ feeCollectInterval: '6h' })
          .expect(403);
      });

      it('200 — superadmin', () => {
        testApp.settingRepo.findOne.mockResolvedValueOnce(activeRow);
        return request(app.getHttpServer())
          .patch('/settings')
          .set('Authorization', `Bearer ${superadminToken}`)
          .send({ feeCollectInterval: '6h' })
          .expect(200);
      });
    });

    // ── POST /settings/:id/activate ───────────────────────────────
    describe('POST /settings/:id/activate', () => {
      it('401 — no token', () =>
        request(app.getHttpServer())
          .post('/settings/2/activate').expect(401));

      it('403 — valid JWT, no role', () => {
        mockRoles([]);
        return request(app.getHttpServer())
          .post('/settings/2/activate')
          .set('Authorization', `Bearer ${noRoleToken}`)
          .expect(403);
      });

      it('403 — valid JWT, admin role', () => {
        mockRoles([{ role: 1 }]);
        return request(app.getHttpServer())
          .post('/settings/2/activate')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(403);
      });

      it('201 — superadmin (with existing preset)', () => {
        const preset = { id: 2, name: 'staging', isActive: false, feeCollectInterval: '24h', deadlineCheckInterval: '5m' };
        testApp.settingRepo.findOne.mockResolvedValueOnce(preset); // getById
        testApp.settingRepo.findOne.mockResolvedValueOnce({ ...preset, isActive: true }); // getActive after activate
        return request(app.getHttpServer())
          .post('/settings/2/activate')
          .set('Authorization', `Bearer ${superadminToken}`)
          .expect(201);
      });
    });

    // ── DELETE /settings/:id ──────────────────────────────────────
    describe('DELETE /settings/:id', () => {
      it('401 — no token', () =>
        request(app.getHttpServer())
          .delete('/settings/2').expect(401));

      it('403 — valid JWT, no role', () => {
        mockRoles([]);
        return request(app.getHttpServer())
          .delete('/settings/2')
          .set('Authorization', `Bearer ${noRoleToken}`)
          .expect(403);
      });

      it('403 — valid JWT, admin role', () => {
        mockRoles([{ role: 1 }]);
        return request(app.getHttpServer())
          .delete('/settings/2')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(403);
      });

      it('200 — superadmin (inactive preset)', () => {
        testApp.settingRepo.findOne.mockResolvedValueOnce({
          id: 2, name: 'old', isActive: false,
        });
        return request(app.getHttpServer())
          .delete('/settings/2')
          .set('Authorization', `Bearer ${superadminToken}`)
          .expect(200);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. Admin endpoints — @Roles('admin')
  // ═══════════════════════════════════════════════════════════════════

  describe('Admin endpoints (admin+)', () => {

    // ── GET /admin/roles ──────────────────────────────────────────
    describe('GET /admin/roles', () => {
      it('401 — no token', () =>
        request(app.getHttpServer()).get('/admin/roles').expect(401));

      it('403 — valid JWT, no role', () => {
        mockRoles([]);
        return request(app.getHttpServer())
          .get('/admin/roles')
          .set('Authorization', `Bearer ${noRoleToken}`)
          .expect(403);
      });

      it('200 — valid JWT, admin role', () => {
        mockRoles([{ role: 1 }]); // for RolesGuard
        testApp.roleRepo.find.mockResolvedValueOnce([]); // for the actual endpoint data
        return request(app.getHttpServer())
          .get('/admin/roles')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
      });

      it('200 — superadmin', () => {
        testApp.roleRepo.find.mockResolvedValueOnce([]); // endpoint data
        return request(app.getHttpServer())
          .get('/admin/roles')
          .set('Authorization', `Bearer ${superadminToken}`)
          .expect(200);
      });

      it('403 — valid JWT, oracle role (not admin)', () => {
        mockRoles([{ role: 2 }]);
        return request(app.getHttpServer())
          .get('/admin/roles')
          .set('Authorization', `Bearer ${oracleToken}`)
          .expect(403);
      });

      it('403 — valid JWT, creator role (not admin)', () => {
        mockRoles([{ role: 3 }]);
        return request(app.getHttpServer())
          .get('/admin/roles')
          .set('Authorization', `Bearer ${oracleToken}`)
          .expect(403);
      });
    });

    // ── GET /admin/markets/stale ──────────────────────────────────
    describe('GET /admin/markets/stale', () => {
      const staleQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };

      it('401 — no token', () =>
        request(app.getHttpServer()).get('/admin/markets/stale').expect(401));

      it('403 — valid JWT, no role', () => {
        mockRoles([]);
        return request(app.getHttpServer())
          .get('/admin/markets/stale')
          .set('Authorization', `Bearer ${noRoleToken}`)
          .expect(403);
      });

      it('200 — valid JWT, admin role', () => {
        mockRoles([{ role: 1 }]);
        testApp.marketRepo.createQueryBuilder.mockReturnValueOnce(staleQb);
        return request(app.getHttpServer())
          .get('/admin/markets/stale')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
      });

      it('200 — superadmin', () => {
        testApp.marketRepo.createQueryBuilder.mockReturnValueOnce(staleQb);
        return request(app.getHttpServer())
          .get('/admin/markets/stale')
          .set('Authorization', `Bearer ${superadminToken}`)
          .expect(200);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. Market creation — @Roles('admin')
  // ═══════════════════════════════════════════════════════════════════

  describe('POST /markets (admin+)', () => {
    const dto = validCreateDto();

    it('401 — no token', () =>
      request(app.getHttpServer()).post('/markets').send(dto).expect(401));

    it('403 — valid JWT, no role', () => {
      mockRoles([]);
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${noRoleToken}`)
        .send(dto)
        .expect(403);
    });

    it('201 — valid JWT, admin role', () => {
      mockRoles([{ role: 1 }]);
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validCreateDto())
        .expect(201);
    });

    it('201 — superadmin', () =>
      request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${superadminToken}`)
        .send(validCreateDto())
        .expect(201));

    it('403 — valid JWT, oracle role (not admin)', () => {
      mockRoles([{ role: 2 }]);
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${oracleToken}`)
        .send(dto)
        .expect(403);
    });

    it('403 — valid JWT, creator role (not admin)', () => {
      mockRoles([{ role: 3 }]);
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${oracleToken}`)
        .send(dto)
        .expect(403);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. Public endpoints — no auth required (regression)
  // ═══════════════════════════════════════════════════════════════════

  describe('Public endpoints remain accessible without auth', () => {
    it('GET /markets — 200 without token', () =>
      request(app.getHttpServer()).get('/markets').expect(200));

    it('GET /markets/1 — 200 without token', () =>
      request(app.getHttpServer()).get('/markets/1').expect(200));

    it('GET /markets/1/prices — 200 without token', () => {
      testApp.marketRepo.findOne.mockResolvedValueOnce({
        id: '1', numOutcomes: 2, reserves: ['500000000', '500000000'],
        totalMinted: '1000000000', kSquared: '500000000000000000',
      });
      return request(app.getHttpServer()).get('/markets/1/prices').expect(200);
    });

    it('GET /markets/1/history — 200 without token', () =>
      request(app.getHttpServer()).get('/markets/1/history').expect(200));

    it('GET /users/:addr/positions — 200 without token', () => {
      testApp.positionRepo.find.mockResolvedValueOnce([]);
      return request(app.getHttpServer())
        .get(`/users/${randomWallet()}/positions`)
        .expect(200);
    });

    it('GET /users/:addr/history — 200 without token', () => {
      testApp.tradeRepo.findAndCount.mockResolvedValueOnce([[], 0]);
      return request(app.getHttpServer())
        .get(`/users/${randomWallet()}/history`)
        .expect(200);
    });

    it('GET /users/:addr/lp-positions — 200 without token', () => {
      testApp.lpPositionRepo.find.mockResolvedValueOnce([]);
      return request(app.getHttpServer())
        .get(`/users/${randomWallet()}/lp-positions`)
        .expect(200);
    });

    it('GET /health — 200 without token', () =>
      request(app.getHttpServer()).get('/health').expect(200));
  });

  // ═══════════════════════════════════════════════════════════════════
  // 5. Edge cases
  // ═══════════════════════════════════════════════════════════════════

  describe('Edge cases', () => {
    it('should return 403 (not 500) for protected endpoint with valid JWT but DB returns empty', () => {
      mockRoles([]);
      return request(app.getHttpServer())
        .get('/settings')
        .set('Authorization', `Bearer ${noRoleToken}`)
        .expect(403)
        .expect((res: any) => {
          expect(res.body.message).toContain('Insufficient role');
        });
    });

    it('should include error message in 403 response body', () => {
      mockRoles([]);
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${noRoleToken}`)
        .send(validCreateDto())
        .expect(403)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('message');
          expect(res.body).toHaveProperty('statusCode', 403);
        });
    });

    it('should distinguish 401 (no/bad token) from 403 (valid token, wrong role)', async () => {
      // 401: no token
      const res401 = await request(app.getHttpServer())
        .get('/settings');
      expect(res401.status).toBe(401);

      // 403: valid token, no role
      mockRoles([]);
      const res403 = await request(app.getHttpServer())
        .get('/settings')
        .set('Authorization', `Bearer ${noRoleToken}`);
      expect(res403.status).toBe(403);
    });

    it('admin with multiple roles including admin should pass admin check', () => {
      mockRoles([{ role: 1 }, { role: 2 }]); // admin + oracle
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validCreateDto())
        .expect(201);
    });
  });
});
