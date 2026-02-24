import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { Keypair } from '@solana/web3.js';
import * as nacl from 'tweetnacl';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;
  const keypair = Keypair.generate();
  const walletAddress = keypair.publicKey.toBase58();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('mock-jwt-token'),
            verify: jest.fn().mockReturnValue({ sub: walletAddress }),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jwtService = module.get<JwtService>(JwtService);
  });

  describe('createChallenge', () => {
    it('should return a nonce and message', () => {
      const result = service.createChallenge(walletAddress);
      expect(result).toHaveProperty('nonce');
      expect(result).toHaveProperty('message');
      expect(typeof result.nonce).toBe('string');
      expect(result.nonce.length).toBe(64); // 32 bytes hex
    });

    it('should include wallet address in the message', () => {
      const result = service.createChallenge(walletAddress);
      expect(result.message).toContain(walletAddress);
    });

    it('should include nonce in the message', () => {
      const result = service.createChallenge(walletAddress);
      expect(result.message).toContain(result.nonce);
    });

    it('should throw for invalid wallet address', () => {
      expect(() => service.createChallenge('not-a-valid-address')).toThrow(
        UnauthorizedException,
      );
    });

    it('should generate unique nonces for each call', () => {
      const r1 = service.createChallenge(walletAddress);
      const r2 = service.createChallenge(walletAddress);
      expect(r1.nonce).not.toBe(r2.nonce);
    });
  });

  describe('verifySignature', () => {
    function createValidSignature(): {
      nonce: string;
      signature: string;
    } {
      const { nonce, message } = service.createChallenge(walletAddress);
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = nacl.sign.detached(
        messageBytes,
        keypair.secretKey,
      );
      const signature = Buffer.from(signatureBytes).toString('base64');
      return { nonce, signature };
    }

    it('should return accessToken for valid signature', () => {
      const { nonce, signature } = createValidSignature();
      const result = service.verifySignature(walletAddress, signature, nonce);
      expect(result).toHaveProperty('accessToken');
      expect(result.accessToken).toBe('mock-jwt-token');
      expect(jwtService.sign).toHaveBeenCalledWith({ sub: walletAddress });
    });

    it('should throw 401 for no pending challenge', () => {
      expect(() =>
        service.verifySignature(walletAddress, 'fake-sig', 'fake-nonce'),
      ).toThrow(UnauthorizedException);
    });

    it('should throw 401 for wrong nonce', () => {
      createValidSignature();
      expect(() =>
        service.verifySignature(walletAddress, 'fake-sig', 'wrong-nonce'),
      ).toThrow(UnauthorizedException);
    });

    it('should throw 401 for invalid signature', () => {
      const { nonce } = createValidSignature();
      const badSig = Buffer.from(new Uint8Array(64)).toString('base64');
      expect(() =>
        service.verifySignature(walletAddress, badSig, nonce),
      ).toThrow(UnauthorizedException);
    });

    it('should throw 401 for expired challenge', () => {
      const { nonce, signature } = createValidSignature();
      // Manually expire the challenge by manipulating time
      const originalNow = Date.now;
      Date.now = jest.fn().mockReturnValue(originalNow() + 6 * 60 * 1000);
      try {
        expect(() =>
          service.verifySignature(walletAddress, signature, nonce),
        ).toThrow(UnauthorizedException);
      } finally {
        Date.now = originalNow;
      }
    });

    it('should consume challenge after successful verification', () => {
      const { nonce, signature } = createValidSignature();
      service.verifySignature(walletAddress, signature, nonce);
      // Second attempt should fail — challenge already consumed
      expect(() =>
        service.verifySignature(walletAddress, signature, nonce),
      ).toThrow(UnauthorizedException);
    });
  });

  describe('verifyToken', () => {
    it('should return decoded payload for valid token', () => {
      const result = service.verifyToken('valid-token');
      expect(result).toEqual({ sub: walletAddress });
    });

    it('should throw 401 for invalid token', () => {
      (jwtService.verify as jest.Mock).mockImplementationOnce(() => {
        throw new Error('invalid');
      });
      expect(() => service.verifyToken('bad-token')).toThrow(
        UnauthorizedException,
      );
    });
  });
});
