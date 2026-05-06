import { IsString, IsNotEmpty, IsInt, IsOptional, IsBoolean, Min, MaxLength, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Matches a positive decimal number like "1", "0.5", "100.123" */
const NUMERIC_STRING = /^\d+(\.\d+)?$/;

export class CreateFaucetConfigDto {
  @ApiProperty({ description: 'Token mint address or "native" for SOL' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(44)
  token!: string;

  @ApiPropertyOptional({ description: 'Human-readable label (e.g. "USDC", "SOL"). Defaults to token address if omitted.' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  label?: string;

  @ApiProperty({ description: 'Amount per request in standard units (e.g. "1.5" for 1.5 SOL)' })
  @IsString()
  @IsNotEmpty()
  @Matches(NUMERIC_STRING, { message: 'amountPerRequest must be a valid positive number' })
  amountPerRequest!: string;

  @ApiProperty({ description: 'Max requests per user per day', default: 3 })
  @IsInt()
  @Min(1)
  maxRequestsPerDay!: number;

  @ApiPropertyOptional({ description: 'Max total amount distributable per day (standard units)' })
  @IsOptional()
  @IsString()
  @Matches(NUMERIC_STRING, { message: 'maxDailyAmount must be a valid positive number' })
  maxDailyAmount?: string;

  @ApiPropertyOptional({ description: 'Total amount distributable across all time (standard units)' })
  @IsOptional()
  @IsString()
  @Matches(NUMERIC_STRING, { message: 'totalAmountSharable must be a valid positive number' })
  totalAmountSharable?: string;

  @ApiPropertyOptional({ description: 'Enable/disable this faucet config', default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
