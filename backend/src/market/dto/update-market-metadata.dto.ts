import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateMarketMetadataDto {
  @ApiPropertyOptional({ description: 'Market category (e.g. crypto)', maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string;

  @ApiPropertyOptional({ description: 'Market subject/asset (e.g. BTC)', maxLength: 32 })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  subject?: string;

  @ApiPropertyOptional({
    description: 'Market icon URL/key. Set null or empty string to clear.',
  })
  @IsOptional()
  @IsString()
  icon?: string | null;

  @ApiPropertyOptional({
    description: 'Market tags. Set null or empty array to clear.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  tags?: string[] | null;
}
