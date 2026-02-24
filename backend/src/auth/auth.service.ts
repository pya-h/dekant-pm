import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { PublicKey } from '@solana/web3.js';
import * as nacl from 'tweetnacl';

interface PendingChallenge {
  nonce: string;
  message: string;
  expiresAt: number;
}

@Injectable()
export class AuthService {
  private challenges = new Map<string, PendingChallenge>();

  constructor(private readonly jwtService: JwtService) {}

  createChallenge(walletAddress: string): { nonce: string; message: string } {
    // Validate the wallet address
    try {
      new PublicKey(walletAddress);
    } catch {
      throw new UnauthorizedException('Invalid wallet address');
    }

    const nonce = randomBytes(32).toString('hex');
    const message = `Sign this message to authenticate with DekantPM.\n\nWallet: ${walletAddress}\nNonce: ${nonce}`;

    this.challenges.set(walletAddress, {
      nonce,
      message,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
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

    // Verify ed25519 signature
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

    // Clean up used challenge
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
