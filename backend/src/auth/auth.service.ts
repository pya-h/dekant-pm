import { Injectable, UnauthorizedException, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { PublicKey } from '@solana/web3.js';
import * as nacl from 'tweetnacl';

interface PendingChallenge {
  nonce: string;
  message: string;
  expiresAt: number;
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // sweep expired every 60s
const MAX_PENDING_CHALLENGES = 10_000; // hard cap to prevent DoS

@Injectable()
export class AuthService implements OnModuleDestroy {
  private challenges = new Map<string, PendingChallenge>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(private readonly jwtService: JwtService) {
    // Periodically evict expired challenges to prevent memory leaks
    this.cleanupTimer = setInterval(() => this.evictExpired(), CLEANUP_INTERVAL_MS);
  }

  onModuleDestroy() {
    clearInterval(this.cleanupTimer);
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, val] of this.challenges) {
      if (now > val.expiresAt) this.challenges.delete(key);
    }
  }

  createChallenge(walletAddress: string): { nonce: string; message: string } {
    try {
      new PublicKey(walletAddress);
    } catch {
      throw new UnauthorizedException('Invalid wallet address');
    }

    // Prevent unbounded growth (DoS via mass challenge requests)
    if (this.challenges.size >= MAX_PENDING_CHALLENGES) {
      this.evictExpired();
      if (this.challenges.size >= MAX_PENDING_CHALLENGES) {
        throw new UnauthorizedException('Too many pending challenges, try again later');
      }
    }

    const nonce = randomBytes(32).toString('hex');
    const message = `Sign this message to authenticate with DekantPM.\n\nWallet: ${walletAddress}\nNonce: ${nonce}`;

    this.challenges.set(walletAddress, {
      nonce,
      message,
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
    });

    return { nonce, message };
  }

  verifySignature(
    walletAddress: string,
    signature: string,
    nonce: string,
  ): { accessToken: string } {
    const challenge = this.challenges.get(walletAddress);

    if (!challenge) {
      throw new UnauthorizedException('No pending challenge for this wallet');
    }

    if (challenge.nonce !== nonce) {
      throw new UnauthorizedException('Invalid nonce');
    }

    if (Date.now() > challenge.expiresAt) {
      this.challenges.delete(walletAddress);
      throw new UnauthorizedException('Challenge expired');
    }

    const messageBytes = new TextEncoder().encode(challenge.message);
    const signatureBytes = Buffer.from(signature, 'base64');
    const publicKeyBytes = new PublicKey(walletAddress).toBytes();

    const isValid = nacl.sign.detached.verify(
      messageBytes,
      signatureBytes,
      publicKeyBytes,
    );

    if (!isValid) {
      throw new UnauthorizedException('Invalid signature');
    }

    this.challenges.delete(walletAddress);

    const payload = { sub: walletAddress };
    const accessToken = this.jwtService.sign(payload);

    return { accessToken };
  }

  verifyToken(token: string): { sub: string } {
    try {
      return this.jwtService.verify(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
