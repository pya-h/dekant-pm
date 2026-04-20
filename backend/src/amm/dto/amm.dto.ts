import { IsNotEmpty, IsNumber, IsOptional, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EstimateBuyDto {
  @ApiProperty({ description: 'Market ID' })
  @IsNumber()
  @IsNotEmpty()
  marketId!: number;

  @ApiPropertyOptional({ description: 'Outcome index (discrete markets)' })
  @IsNumber()
  @IsOptional()
  outcome?: number;

  @ApiProperty({ description: 'Collateral amount' })
  @IsNumber()
  @IsNotEmpty()
  @Min(1)
  amount!: number;

  @ApiPropertyOptional({ description: 'Distribution center (continuous markets)' })
  @IsNumber()
  @IsOptional()
  mu?: number;

  @ApiPropertyOptional({ description: 'Distribution width (continuous markets)' })
  @IsNumber()
  @IsOptional()
  sigma?: number;
}

export class EstimateBuyBySharesDto {
  @ApiProperty({ description: 'Market ID' })
  @IsNumber()
  @IsNotEmpty()
  marketId!: number;

  @ApiProperty({ description: 'Outcome index' })
  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  outcome!: number;

  @ApiProperty({ description: 'Desired token amount (base units)' })
  @IsNumber()
  @IsNotEmpty()
  @Min(1)
  desiredTokens!: number;
}

export class EstimateSellByCollateralDto {
  @ApiProperty({ description: 'Market ID' })
  @IsNumber()
  @IsNotEmpty()
  marketId!: number;

  @ApiPropertyOptional({ description: 'Outcome index (discrete markets)' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  outcome?: number;

  @ApiProperty({ description: 'Desired collateral received (base units)' })
  @IsNumber()
  @IsNotEmpty()
  @Min(1)
  desiredCollateral!: number;

  @ApiPropertyOptional({ description: 'Distribution center (continuous markets)' })
  @IsNumber()
  @IsOptional()
  mu?: number;

  @ApiPropertyOptional({ description: 'Distribution width (continuous markets)' })
  @IsNumber()
  @IsOptional()
  sigma?: number;
}

export class EstimateSellDto {
  @ApiProperty({ description: 'Market ID' })
  @IsNumber()
  @IsNotEmpty()
  marketId!: number;

  @ApiPropertyOptional({ description: 'Outcome index' })
  @IsNumber()
  @IsOptional()
  outcome?: number;

  @ApiProperty({ description: 'Token amount to sell' })
  @IsNumber()
  @IsNotEmpty()
  @Min(1)
  amount!: number;

  @ApiPropertyOptional({ description: 'Distribution center (continuous markets)' })
  @IsNumber()
  @IsOptional()
  mu?: number;

  @ApiPropertyOptional({ description: 'Distribution width (continuous markets)' })
  @IsNumber()
  @IsOptional()
  sigma?: number;
}

export class EstimateBuyToPriceDto {
  @ApiProperty({ description: 'Market ID' })
  @IsNumber()
  @IsNotEmpty()
  marketId!: number;

  @ApiProperty({ description: 'Outcome index' })
  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  outcome!: number;

  @ApiProperty({
    description:
      'Target probability (SCALE-denominated, e.g. 700000000 = 70%)',
  })
  @IsNumber()
  @IsNotEmpty()
  @Min(1)
  targetProbability!: number;
}

export class EstimateSellToPriceDto {
  @ApiProperty({ description: 'Market ID' })
  @IsNumber()
  @IsNotEmpty()
  marketId!: number;

  @ApiProperty({ description: 'Outcome index' })
  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  outcome!: number;

  @ApiProperty({
    description:
      'Target probability (SCALE-denominated, e.g. 300000000 = 30%)',
  })
  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  targetProbability!: number;
}
