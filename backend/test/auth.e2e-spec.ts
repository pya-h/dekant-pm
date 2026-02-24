import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import * as nacl from 'tweetnacl';
import { Keypair } from '@solana/web3.js';
import { AuthService } from '../src/auth/auth.service';
import { createTestApp, TestApp } from './helpers/test-app';
import { randomWallet, validCreateDto } from './helpers/mock-factories';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let authService: AuthService;
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
    ({ app, jwtService, authService } = testApp);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /auth/challenge', () => {
    it('should create a challenge for a valid wallet', () => {
      const wallet = randomWallet();
      return request(app.getHttpServer())
        .post('/auth/challenge')
        .send({ walletAddress: wallet })
        .expect(201)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('nonce');
          expect(res.body).toHaveProperty('message');
          expect(typeof res.body.nonce).toBe('string');
          expect(res.body.nonce).toHaveLength(64);
          expect(res.body.message).toContain('DekantPM');
          expect(res.body.message).toContain(wallet);
          expect(res.body.message).toContain(res.body.nonce);
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
        .send({ walletAddress: randomWallet(), extra: 'bad' })
        .expect(400);
    });

    it('should reject invalid Solana wallet address', () => {
      return request(app.getHttpServer())
        .post('/auth/challenge')
        .send({ walletAddress: 'not-a-valid-base58-address!!!' })
        .expect(401);
    });

    it('should reject numeric walletAddress', () => {
      return request(app.getHttpServer())
        .post('/auth/challenge')
        .send({ walletAddress: 12345 })
        .expect(400);
    });

    it('should overwrite previous challenge for same wallet', async () => {
      const wallet = randomWallet();
      const res1 = await request(app.getHttpServer())
        .post('/auth/challenge')
        .send({ walletAddress: wallet })
        .expect(201);

      const res2 = await request(app.getHttpServer())
        .post('/auth/challenge')
        .send({ walletAddress: wallet })
        .expect(201);

      expect(res2.body.nonce).not.toBe(res1.body.nonce);
    });

    it('should generate unique nonces for different wallets', async () => {
      const res1 = await request(app.getHttpServer())
        .post('/auth/challenge')
        .send({ walletAddress: randomWallet() })
        .expect(201);

      const res2 = await request(app.getHttpServer())
        .post('/auth/challenge')
        .send({ walletAddress: randomWallet() })
        .expect(201);

      expect(res1.body.nonce).not.toBe(res2.body.nonce);
    });
  });

  describe('POST /auth/verify', () => {
    it('should reject verify without a pending challenge', () => {
      return request(app.getHttpServer())
        .post('/auth/verify')
        .send({
          walletAddress: randomWallet(),
          signature: 'badsig',
          nonce: 'badnonce',
        })
        .expect(401);
    });

    it('should reject missing fields', () => {
      return request(app.getHttpServer())
        .post('/auth/verify')
        .send({ walletAddress: randomWallet() })
        .expect(400);
    });

    it('should reject missing signature', () => {
      return request(app.getHttpServer())
        .post('/auth/verify')
        .send({ walletAddress: randomWallet(), nonce: 'somenonce' })
        .expect(400);
    });

    it('should reject missing nonce', () => {
      return request(app.getHttpServer())
        .post('/auth/verify')
        .send({ walletAddress: randomWallet(), signature: 'somesig' })
        .expect(400);
    });

    it('should reject non-whitelisted fields', () => {
      return request(app.getHttpServer())
        .post('/auth/verify')
        .send({
          walletAddress: randomWallet(),
          signature: 'sig',
          nonce: 'nonce',
          extraField: 'bad',
        })
        .expect(400);
    });

    it('should reject wrong nonce for a pending challenge', async () => {
      const kp = Keypair.generate();
      const wallet = kp.publicKey.toBase58();

      await request(app.getHttpServer())
        .post('/auth/challenge')
        .send({ walletAddress: wallet })
        .expect(201);

      return request(app.getHttpServer())
        .post('/auth/verify')
        .send({
          walletAddress: wallet,
          signature: Buffer.from('fake').toString('base64'),
          nonce: 'wrong-nonce',
        })
        .expect(401)
        .expect((res: any) => {
          expect(res.body.message).toContain('nonce');
        });
    });

    it('should reject invalid signature with correct nonce', async () => {
      const kp = Keypair.generate();
      const wallet = kp.publicKey.toBase58();

      const challengeRes = await request(app.getHttpServer())
        .post('/auth/challenge')
        .send({ walletAddress: wallet })
        .expect(201);

      // Must be exactly 64 bytes (ed25519 sig size) to avoid nacl throwing
      const badSig = Buffer.alloc(64, 0).toString('base64');

      return request(app.getHttpServer())
        .post('/auth/verify')
        .send({
          walletAddress: wallet,
          signature: badSig,
          nonce: challengeRes.body.nonce,
        })
        .expect(401)
        .expect((res: any) => {
          expect(res.body.message).toContain('signature');
        });
    });

    it('should issue JWT for a valid ed25519 signature', async () => {
      const kp = Keypair.generate();
      const wallet = kp.publicKey.toBase58();

      const challengeRes = await request(app.getHttpServer())
        .post('/auth/challenge')
        .send({ walletAddress: wallet })
        .expect(201);

      const messageBytes = new TextEncoder().encode(
        challengeRes.body.message,
      );
      const signature = nacl.sign.detached(messageBytes, kp.secretKey);
      const signatureBase64 = Buffer.from(signature).toString('base64');

      return request(app.getHttpServer())
        .post('/auth/verify')
        .send({
          walletAddress: wallet,
          signature: signatureBase64,
          nonce: challengeRes.body.nonce,
        })
        .expect(201)
        .expect((res: any) => {
          expect(res.body).toHaveProperty('accessToken');
          expect(typeof res.body.accessToken).toBe('string');
          const decoded = jwtService.verify(res.body.accessToken);
          expect(decoded.sub).toBe(wallet);
        });
    });

    it('should not allow reusing a challenge after successful verify', async () => {
      const kp = Keypair.generate();
      const wallet = kp.publicKey.toBase58();

      const challengeRes = await request(app.getHttpServer())
        .post('/auth/challenge')
        .send({ walletAddress: wallet })
        .expect(201);

      const messageBytes = new TextEncoder().encode(
        challengeRes.body.message,
      );
      const signature = nacl.sign.detached(messageBytes, kp.secretKey);
      const signatureBase64 = Buffer.from(signature).toString('base64');

      await request(app.getHttpServer())
        .post('/auth/verify')
        .send({
          walletAddress: wallet,
          signature: signatureBase64,
          nonce: challengeRes.body.nonce,
        })
        .expect(201);

      return request(app.getHttpServer())
        .post('/auth/verify')
        .send({
          walletAddress: wallet,
          signature: signatureBase64,
          nonce: challengeRes.body.nonce,
        })
        .expect(401);
    });

    it('should reject signature from wrong keypair', async () => {
      const realKp = Keypair.generate();
      const fakeKp = Keypair.generate();
      const wallet = realKp.publicKey.toBase58();

      const challengeRes = await request(app.getHttpServer())
        .post('/auth/challenge')
        .send({ walletAddress: wallet })
        .expect(201);

      const messageBytes = new TextEncoder().encode(
        challengeRes.body.message,
      );
      const signature = nacl.sign.detached(messageBytes, fakeKp.secretKey);
      const signatureBase64 = Buffer.from(signature).toString('base64');

      return request(app.getHttpServer())
        .post('/auth/verify')
        .send({
          walletAddress: wallet,
          signature: signatureBase64,
          nonce: challengeRes.body.nonce,
        })
        .expect(401);
    });

    it('should reject expired challenge', async () => {
      const kp = Keypair.generate();
      const wallet = kp.publicKey.toBase58();

      const challengeRes = await request(app.getHttpServer())
        .post('/auth/challenge')
        .send({ walletAddress: wallet })
        .expect(201);

      const challenges = (authService as any).challenges as Map<string, any>;
      const stored = challenges.get(wallet);
      stored.expiresAt = Date.now() - 1000;

      const messageBytes = new TextEncoder().encode(
        challengeRes.body.message,
      );
      const signature = nacl.sign.detached(messageBytes, kp.secretKey);
      const signatureBase64 = Buffer.from(signature).toString('base64');

      return request(app.getHttpServer())
        .post('/auth/verify')
        .send({
          walletAddress: wallet,
          signature: signatureBase64,
          nonce: challengeRes.body.nonce,
        })
        .expect(401)
        .expect((res: any) => {
          expect(res.body.message).toContain('expired');
        });
    });
  });

  describe('AuthGuard (JWT validation)', () => {
    const dto = validCreateDto();

    it('should reject missing Authorization header', () => {
      return request(app.getHttpServer())
        .post('/markets')
        .send(dto)
        .expect(401);
    });

    it('should reject Authorization header without Bearer prefix', () => {
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', 'Token some-token')
        .send(dto)
        .expect(401);
    });

    it('should reject empty Bearer token', () => {
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', 'Bearer ')
        .send(dto)
        .expect(401);
    });

    it('should reject malformed JWT', () => {
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', 'Bearer not.a.jwt')
        .send(dto)
        .expect(401);
    });

    it('should reject JWT signed with wrong secret', () => {
      const wrongJwtService = new JwtService({
        secret: 'wrong-secret-key-that-is-different',
      });
      const badToken = wrongJwtService.sign({ sub: 'wallet' });
      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${badToken}`)
        .send(dto)
        .expect(401);
    });

    it('should reject expired JWT', () => {
      const expiredToken = jwtService.sign(
        { sub: 'TestWallet' },
        { expiresIn: '0s' },
      );
      return new Promise((resolve) => setTimeout(resolve, 50)).then(() =>
        request(app.getHttpServer())
          .post('/markets')
          .set('Authorization', `Bearer ${expiredToken}`)
          .send(dto)
          .expect(401),
      );
    });

    it('should accept valid JWT from real auth flow', async () => {
      const kp = Keypair.generate();
      const wallet = kp.publicKey.toBase58();

      const challengeRes = await request(app.getHttpServer())
        .post('/auth/challenge')
        .send({ walletAddress: wallet })
        .expect(201);

      const messageBytes = new TextEncoder().encode(
        challengeRes.body.message,
      );
      const signature = nacl.sign.detached(messageBytes, kp.secretKey);
      const signatureBase64 = Buffer.from(signature).toString('base64');

      const verifyRes = await request(app.getHttpServer())
        .post('/auth/verify')
        .send({
          walletAddress: wallet,
          signature: signatureBase64,
          nonce: challengeRes.body.nonce,
        })
        .expect(201);

      return request(app.getHttpServer())
        .post('/markets')
        .set('Authorization', `Bearer ${verifyRes.body.accessToken}`)
        .send(dto)
        .expect(201);
    });
  });
});
