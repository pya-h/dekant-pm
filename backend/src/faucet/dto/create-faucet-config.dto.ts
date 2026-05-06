import { IsString, IsNotEmpty, IsInt, IsOptional, IsBoolean, Min, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateFaucetConfigDto {
  @ApiProperty({ description: 'Token mint address or "native" for SOL' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(44)
  token!: string;

  @ApiProperty({ description: 'Human-readable label (e.g. "USDC", "SOL")' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  label!: string;

  @ApiProperty({ description: 'Amount per request in smallest unit (lamports / token base units)' })
  @IsString()
  @IsNotEmpty()
  amountPerRequest!: string;

  @ApiProperty({ description: 'Max requests per user per day', default: 3 })
  @IsInt()
  @Min(1)
  maxRequestsPerDay!: number;

  @ApiPropertyOptional({ description: 'Max total amount sharable per day across all users' })
  @IsOptional()
  @IsString()
  maxDailyAmount?: string;

  @ApiPropertyOptional({ description: 'Total amount sharable across all time' })
  @IsOptional()
  @IsString()
  totalAmountSharable?: string;

  @ApiPropertyOptional({ description: 'Enable/disable this faucet config', default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
