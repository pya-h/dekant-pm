import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMarketDto {
  @ApiProperty({ description: 'Market title' })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiPropertyOptional({ description: 'Market description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ description: 'Category' })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({ description: 'Tags', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @ApiPropertyOptional({ description: 'Image URL' })
  @IsString()
  @IsOptional()
  imageUrl?: string;

  @ApiPropertyOptional({ description: 'Outcome labels', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  outcomeLabels?: string[];

  @ApiProperty({ description: 'On-chain market ID' })
  @IsNumber()
  marketId!: number;

  @ApiProperty({ description: 'Market PDA pubkey (base58)' })
  @IsString()
  @IsNotEmpty()
  pubkey!: string;

  @ApiProperty({ description: 'Market type: 0=binary, 1=multi, 2=continuous' })
  @IsNumber()
  @Min(0)
  @Max(2)
  marketType!: number;

  @ApiProperty({ description: 'Number of outcomes' })
  @IsNumber()
  @Min(2)
  @Max(256)
  numOutcomes!: number;

  @ApiProperty({ description: 'Creator wallet address' })
  @IsString()
  @IsNotEmpty()
  creator!: string;

  @ApiProperty({ description: 'Oracle wallet address' })
  @IsString()
  @IsNotEmpty()
  oracle!: string;

  @ApiProperty({ description: 'Collateral mint address' })
  @IsString()
  @IsNotEmpty()
  collateralMint!: string;

  @ApiProperty({ description: 'Market deadline (ISO timestamp)' })
  @IsString()
  @IsNotEmpty()
  deadline!: string;

  @ApiPropertyOptional({ description: 'Range min (continuous markets)' })
  @IsNumber()
  @IsOptional()
  rangeMin?: number;

  @ApiPropertyOptional({ description: 'Range max (continuous markets)' })
  @IsNumber()
  @IsOptional()
  rangeMax?: number;
}
