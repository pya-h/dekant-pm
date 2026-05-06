import { IsString, IsInt, IsOptional, IsBoolean, Min, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateFaucetConfigDto {
  @ApiPropertyOptional({ description: 'Human-readable label' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  label?: string;

  @ApiPropertyOptional({ description: 'Amount per request in smallest unit' })
  @IsOptional()
  @IsString()
  amountPerRequest?: string;

  @ApiPropertyOptional({ description: 'Max requests per user per day' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxRequestsPerDay?: number;

  @ApiPropertyOptional({ description: 'Max total amount sharable per day (null to remove limit)' })
  @IsOptional()
  @IsString()
  maxDailyAmount?: string | null;

  @ApiPropertyOptional({ description: 'Total amount sharable across all time (null to remove limit)' })
  @IsOptional()
  @IsString()
  totalAmountSharable?: string | null;

  @ApiPropertyOptional({ description: 'Enable/disable' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
