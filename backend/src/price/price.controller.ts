import {
  Controller,
  Get,
  Param,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import {
  PriceService,
  MarketNotFoundError,
  NonCryptoCategoryError,
  TokenNotFoundError,
} from './price.service';

@ApiTags('prices')
@Controller('prices')
export class PriceController {
  constructor(private readonly priceService: PriceService) {}

  @Get('market/:id')
  @ApiOperation({ summary: 'Get live asset price for a market' })
  @ApiParam({ name: 'id', description: 'Market ID' })
  @ApiResponse({ status: 200, description: 'Token price data' })
  @ApiResponse({ status: 404, description: 'Market or token not found' })
  @ApiResponse({ status: 503, description: 'Market category is not crypto' })
  async getMarketPrice(@Param('id') id: string) {
    try {
      return await this.priceService.getMarketPrice(id);
    } catch (err) {
      if (err instanceof MarketNotFoundError) {
        throw new HttpException(err.message, HttpStatus.NOT_FOUND);
      }
      if (err instanceof NonCryptoCategoryError) {
        throw new HttpException(err.message, HttpStatus.SERVICE_UNAVAILABLE);
      }
      if (err instanceof TokenNotFoundError) {
        throw new HttpException(err.message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(
        'Failed to fetch price',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}
