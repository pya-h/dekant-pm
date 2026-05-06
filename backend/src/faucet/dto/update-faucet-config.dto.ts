import { IsString, IsInt, IsOptional, IsBoolean, Min, Max, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateFaucetConfigDto {
  @ApiPropertyOptional({ description: 'Human-readable label' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  label?: string | null;

  @ApiPropertyOptional({ description: 'Token decimals' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(18)
  decimals?: number;

  @ApiPropertyOptional({ description: 'Amount per request in standard units' })
  @IsOptional()
  @IsString()
  amountPerRequest?: string;

  @ApiPropertyOptional({ description: 'Max requests per user per day' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxRequestsPerDay?: number;

  @ApiPropertyOptional({ description: 'Max total amount distributable per day (standard units, null to remove)' })
  @IsOptional()
  @IsString()
  maxDailyAmount?: string | null;

  @ApiPropertyOptional({ description: 'Total amount distributable across all time (standard units, null to remove)' })
  @IsOptional()
  @IsString()
  totalAmountSharable?: string | null;

  @ApiPropertyOptional({ description: 'Enable/disable' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
