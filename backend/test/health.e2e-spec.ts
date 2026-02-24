import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, TestApp } from './helpers/test-app';

describe('Health & Routing (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health', () => {
    it('should return ok status', () => {
      return request(app.getHttpServer())
        .get('/health')
        .expect(200)
        .expect({ status: 'ok' });
    });
  });

  describe('Unknown routes', () => {
    it('should return 404 for unknown GET path', () => {
      return request(app.getHttpServer()).get('/nonexistent').expect(404);
    });

    it('should return 404 for unknown POST path', () => {
      return request(app.getHttpServer())
        .post('/nonexistent')
        .send({})
        .expect(404);
    });
  });
});
