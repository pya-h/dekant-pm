import { IsString, IsInt, IsOptional, IsBoolean, Min, MaxLength, Matches, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Matches a positive decimal number like "1", "0.5", "100.123" */
const NUMERIC_STRING = /^\d+(\.\d+)?$/;

export class UpdateFaucetConfigDto {
  @ApiPropertyOptional({ description: 'Human-readable label' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  label?: string | null;

  @ApiPropertyOptional({ description: 'Amount per request in standard units' })
  @IsOptional()
  @IsString()
  @Matches(NUMERIC_STRING, { message: 'amountPerRequest must be a valid positive number' })
  amountPerRequest?: string;

  @ApiPropertyOptional({ description: 'Max requests per user per day' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxRequestsPerDay?: number;

  @ApiPropertyOptional({ description: 'Max total amount distributable per day (standard units, null to remove)' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Matches(NUMERIC_STRING, { message: 'maxDailyAmount must be a valid positive number' })
  maxDailyAmount?: string | null;

  @ApiPropertyOptional({ description: 'Total amount distributable across all time (standard units, null to remove)' })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Matches(NUMERIC_STRING, { message: 'totalAmountSharable must be a valid positive number' })
  totalAmountSharable?: string | null;

  @ApiPropertyOptional({ description: 'Enable/disable' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
