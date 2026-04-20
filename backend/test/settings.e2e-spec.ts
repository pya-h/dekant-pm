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

  describe('GET /settings', () => {
    it('should require authentication', () => {
      return request(app.getHttpServer()).get('/settings').expect(401);
    });

    it('should return default settings when row does not exist', () => {
      testApp.settingRepo.findOne.mockResolvedValueOnce(null);
      return request(app.getHttpServer())
        .get('/settings')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('feeCollectInterval');
          expect(res.body.feeCollectInterval).toBe('none');
        });
    });

    it('should return stored settings', () => {
      testApp.settingRepo.findOne.mockResolvedValueOnce({
        id: 1,
        feeCollectInterval: '12h',
      });
      return request(app.getHttpServer())
        .get('/settings')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .expect(200)
        .expect((res: any) => {
          expect(res.body.feeCollectInterval).toBe('12h');
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

    it('should update feeCollectInterval with valid value', () => {
      testApp.settingRepo.findOne.mockResolvedValueOnce({
        id: 1,
        feeCollectInterval: 'none',
      });
      return request(app.getHttpServer())
        .patch('/settings')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .send({ feeCollectInterval: '6h' })
        .expect(200)
        .expect((res: any) => {
          expect(res.body.feeCollectInterval).toBe('6h');
        });
    });

    it('should accept "none" to disable', () => {
      testApp.settingRepo.findOne.mockResolvedValueOnce({
        id: 1,
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
      'should accept valid interval: %s',
      (interval) => {
        testApp.settingRepo.findOne.mockResolvedValueOnce({
          id: 1,
          feeCollectInterval: 'none',
        });
        return request(app.getHttpServer())
          .patch('/settings')
          .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
          .send({ feeCollectInterval: interval })
          .expect(200);
      },
    );

    it('should reject invalid interval value', () => {
      return request(app.getHttpServer())
        .patch('/settings')
        .set('Authorization', `Bearer ${testApp.getAuthToken()}`)
        .send({ feeCollectInterval: '3h' })
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
});
