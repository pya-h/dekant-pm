import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { createTestApp, TestApp } from './helpers/test-app';

describe('Settings (e2e)', () => {
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

  const activeRow = {
    id: 1,
    name: 'default',
    isActive: true,
    feeCollectInterval: 'none',
    deadlineCheckInterval: '1m',
  };

  describe('GET /settings', () => {
    it('should require authentication', () => {
      return request(app.getHttpServer()).get('/settings').expect(401);
    });

    it('should return default settings when no active row exists', () => {
      testApp.settingRepo.findOne.mockResolvedValueOnce(null);
      return request(app.getHttpServer())
        .get('/settings')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('feeCollectInterval', 'none');
          expect(res.body).toHaveProperty('deadlineCheckInterval', '1m');
          expect(res.body).toHaveProperty('isActive', true);
        });
    });

    it('should return stored active settings', () => {
      testApp.settingRepo.findOne.mockResolvedValueOnce({
        ...activeRow,
        feeCollectInterval: '12h',
        deadlineCheckInterval: '5m',
      });
      return request(app.getHttpServer())
        .get('/settings')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .expect(200)
        .expect((res: any) => {
          expect(res.body.feeCollectInterval).toBe('12h');
          expect(res.body.deadlineCheckInterval).toBe('5m');
        });
    });

    it('should reject expired token', () => {
      const expiredToken = jwtService.sign(
        { sub: 'TestWallet' },
        { expiresIn: '0s' },
      );
      return new Promise((resolve) => setTimeout(resolve, 50)).then(() =>
        request(app.getHttpServer())
          .get('/settings')
          .set('Authorization', `Bearer ${expiredToken}`)
          .expect(401),
      );
    });
  });

  describe('PATCH /settings', () => {
    it('should require authentication', () => {
      return request(app.getHttpServer())
        .patch('/settings')
        .send({ feeCollectInterval: '6h' })
        .expect(401);
    });

    it('should update feeCollectInterval', () => {
      testApp.settingRepo.findOne.mockResolvedValueOnce({ ...activeRow });
      return request(app.getHttpServer())
        .patch('/settings')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .send({ feeCollectInterval: '6h' })
        .expect(200)
        .expect((res: any) => {
          expect(res.body.feeCollectInterval).toBe('6h');
        });
    });

    it('should update deadlineCheckInterval', () => {
      testApp.settingRepo.findOne.mockResolvedValueOnce({ ...activeRow });
      return request(app.getHttpServer())
        .patch('/settings')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .send({ deadlineCheckInterval: '5m' })
        .expect(200)
        .expect((res: any) => {
          expect(res.body.deadlineCheckInterval).toBe('5m');
        });
    });

    it('should accept "none" for fee interval', () => {
      testApp.settingRepo.findOne.mockResolvedValueOnce({
        ...activeRow,
        feeCollectInterval: '6h',
      });
      return request(app.getHttpServer())
        .patch('/settings')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .send({ feeCollectInterval: 'none' })
        .expect(200)
        .expect((res: any) => {
          expect(res.body.feeCollectInterval).toBe('none');
        });
    });

    it.each(['6h', '12h', '24h', '48h', 'none'])(
      'should accept valid fee interval: %s',
      (interval) => {
        testApp.settingRepo.findOne.mockResolvedValueOnce({ ...activeRow });
        return request(app.getHttpServer())
          .patch('/settings')
          .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
          .send({ feeCollectInterval: interval })
          .expect(200);
      },
    );

    it.each(['30s', '1m', '2m', '5m', '10m'])(
      'should accept valid deadline interval: %s',
      (interval) => {
        testApp.settingRepo.findOne.mockResolvedValueOnce({ ...activeRow });
        return request(app.getHttpServer())
          .patch('/settings')
          .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
          .send({ deadlineCheckInterval: interval })
          .expect(200);
      },
    );

    it('should reject invalid fee interval value', () => {
      return request(app.getHttpServer())
        .patch('/settings')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .send({ feeCollectInterval: '3h' })
        .expect(400);
    });

    it('should reject invalid deadline interval value', () => {
      return request(app.getHttpServer())
        .patch('/settings')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .send({ deadlineCheckInterval: '15m' })
        .expect(400);
    });

    it('should reject non-whitelisted fields', () => {
      return request(app.getHttpServer())
        .patch('/settings')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .send({ feeCollectInterval: '6h', extra: 'bad' })
        .expect(400);
    });

    it('should reject malformed token', () => {
      return request(app.getHttpServer())
        .patch('/settings')
        .set('Authorization', 'Bearer garbage')
        .send({ feeCollectInterval: '6h' })
        .expect(401);
    });
  });

  describe('POST /settings', () => {
    it('should require authentication', () => {
      return request(app.getHttpServer())
        .post('/settings')
        .send({ name: 'staging' })
        .expect(401);
    });

    it('should create a new inactive settings preset', () => {
      return request(app.getHttpServer())
        .post('/settings')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .send({ name: 'staging', feeCollectInterval: '24h', deadlineCheckInterval: '5m' })
        .expect(201)
        .expect((res: any) => {
          expect(res.body.isActive).toBe(false);
          expect(res.body.name).toBe('staging');
          expect(res.body.feeCollectInterval).toBe('24h');
          expect(res.body.deadlineCheckInterval).toBe('5m');
        });
    });

    it('should reject invalid fee interval on create', () => {
      return request(app.getHttpServer())
        .post('/settings')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .send({ name: 'bad', feeCollectInterval: 'invalid' })
        .expect(400);
    });
  });

  describe('GET /settings/all', () => {
    it('should require authentication', () => {
      return request(app.getHttpServer()).get('/settings/all').expect(401);
    });

    it('should return all settings rows', () => {
      testApp.settingRepo.find.mockResolvedValueOnce([
        { ...activeRow },
        { id: 2, name: 'staging', isActive: false, feeCollectInterval: '24h', deadlineCheckInterval: '5m' },
      ]);
      return request(app.getHttpServer())
        .get('/settings/all')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveLength(2);
          expect(res.body[0].isActive).toBe(true);
          expect(res.body[1].isActive).toBe(false);
        });
    });
  });

  describe('POST /settings/:id/activate', () => {
    it('should require authentication', () => {
      return request(app.getHttpServer())
        .post('/settings/2/activate')
        .expect(401);
    });

    it('should activate a preset', () => {
      // getById returns the row
      testApp.settingRepo.findOne.mockResolvedValueOnce({
        id: 2,
        name: 'staging',
        isActive: false,
        feeCollectInterval: '24h',
        deadlineCheckInterval: '5m',
      });
      // After activate, getActive returns the newly activated row
      testApp.settingRepo.findOne.mockResolvedValueOnce({
        id: 2,
        name: 'staging',
        isActive: true,
        feeCollectInterval: '24h',
        deadlineCheckInterval: '5m',
      });
      return request(app.getHttpServer())
        .post('/settings/2/activate')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .expect(201)
        .expect((res: any) => {
          expect(res.body.isActive).toBe(true);
          expect(res.body.id).toBe(2);
        });
    });

    it('should return 404 for non-existent preset', () => {
      testApp.settingRepo.findOne.mockResolvedValueOnce(null);
      return request(app.getHttpServer())
        .post('/settings/999/activate')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .expect(404);
    });
  });

  describe('DELETE /settings/:id', () => {
    it('should require authentication', () => {
      return request(app.getHttpServer())
        .delete('/settings/2')
        .expect(401);
    });

    it('should delete an inactive preset', () => {
      testApp.settingRepo.findOne.mockResolvedValueOnce({
        id: 2,
        name: 'staging',
        isActive: false,
      });
      return request(app.getHttpServer())
        .delete('/settings/2')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .expect(200)
        .expect((res: any) => {
          expect(res.body.deleted).toBe(true);
        });
    });

    it('should refuse to delete the active preset', () => {
      testApp.settingRepo.findOne.mockResolvedValueOnce({
        id: 1,
        name: 'default',
        isActive: true,
      });
      return request(app.getHttpServer())
        .delete('/settings/1')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .expect(400);
    });

    it('should return 404 for non-existent preset', () => {
      testApp.settingRepo.findOne.mockResolvedValueOnce(null);
      return request(app.getHttpServer())
        .delete('/settings/999')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .expect(404);
    });
  });
});
