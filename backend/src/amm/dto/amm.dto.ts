import { IsNotEmpty, IsNumber, IsOptional } from 'class-validator';
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
  amount!: number;
}
