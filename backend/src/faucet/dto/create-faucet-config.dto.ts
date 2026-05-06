import { IsString, IsNotEmpty, IsInt, IsOptional, IsBoolean, IsNumber, Min, Max, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

  @ApiProperty({ description: 'Token decimals (e.g. 9 for SOL, 6 for USDC)', default: 9 })
  @IsInt()
  @Min(0)
  @Max(18)
  decimals!: number;

  @ApiProperty({ description: 'Amount per request in standard units (e.g. "1.5" for 1.5 SOL)' })
  @IsString()
  @IsNotEmpty()
  amountPerRequest!: string;

  @ApiProperty({ description: 'Max requests per user per day', default: 3 })
  @IsInt()
  @Min(1)
  maxRequestsPerDay!: number;

  @ApiPropertyOptional({ description: 'Max total amount distributable per day (standard units)' })
  @IsOptional()
  @IsString()
  maxDailyAmount?: string;

  @ApiPropertyOptional({ description: 'Total amount distributable across all time (standard units)' })
  @IsOptional()
  @IsString()
  totalAmountSharable?: string;

  @ApiPropertyOptional({ description: 'Enable/disable this faucet config', default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
