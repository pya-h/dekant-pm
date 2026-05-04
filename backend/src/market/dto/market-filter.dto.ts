import { IsOptional, IsString, IsNumber, IsIn, IsBoolean, MaxLength, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';

export class MarketFilterDto {
  @ApiPropertyOptional({ description: 'Filter by category' })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({ description: 'Filter by subject/asset (e.g. BTC, ETH, SOL)' })
  @IsString()
  @IsOptional()
  subject?: string;

  @ApiPropertyOptional({ description: 'Filter by market type: 0=binary, 1=multi, 2=continuous' })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  marketType?: number;

  @ApiPropertyOptional({ description: 'Filter by state: 0=active, 1=paused, 2=pending, 3=resolved' })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  state?: number;

  @ApiPropertyOptional({ description: 'Filter by oracle wallet address' })
  @IsString()
  @IsOptional()
  oracle?: string;

  @ApiPropertyOptional({ description: 'Filter by creator wallet address' })
  @IsString()
  @IsOptional()
  creator?: string;

  @ApiPropertyOptional({ description: 'Text search on title' })
  @IsString()
  @MaxLength(200)
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ description: 'Sort by: newest, deadline, volume', default: 'newest' })
  @IsIn(['newest', 'deadline', 'volume'])
  @IsOptional()
  sortBy?: 'newest' | 'deadline' | 'volume';

  @ApiPropertyOptional({ description: 'Page number (1-based)', default: 1 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number;

  @ApiPropertyOptional({ description: 'Include aggregate stats (totalVolume, totalTraders)' })
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  @IsOptional()
  includeStats?: boolean;
}
