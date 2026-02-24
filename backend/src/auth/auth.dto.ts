import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChallengeDto {
  @ApiProperty({ description: 'Solana wallet address (base58)' })
  @IsString()
  @IsNotEmpty()
  walletAddress!: string;
}

export class VerifyDto {
  @ApiProperty({ description: 'Solana wallet address (base58)' })
  @IsString()
  @IsNotEmpty()
  walletAddress!: string;

  @ApiProperty({ description: 'Base64-encoded ed25519 signature' })
  @IsString()
  @IsNotEmpty()
  signature!: string;

  @ApiProperty({ description: 'Nonce from the challenge' })
  @IsString()
  @IsNotEmpty()
  nonce!: string;
}
