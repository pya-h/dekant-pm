import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AmmService } from './amm.service';
import { EstimateBuyDto, EstimateSellDto } from './dto/amm.dto';

@ApiTags('amm')
@Controller('amm')
export class AmmController {
  constructor(private readonly ammService: AmmService) {}

  @Post('estimate-buy')
  @ApiOperation({ summary: 'Estimate buy cost and tokens received' })
  @ApiResponse({ status: 200, description: 'Buy estimate' })
  estimateBuy(@Body() dto: EstimateBuyDto) {
    if (dto.mu !== undefined && dto.sigma !== undefined) {
      return this.ammService.estimateDistributionBuy(
        dto.marketId,
        dto.mu,
        dto.sigma,
        dto.amount,
      );
    }
    return this.ammService.estimateBuy(
      dto.marketId,
      dto.outcome ?? 0,
      dto.amount,
    );
  }

  @Post('estimate-sell')
  @ApiOperation({ summary: 'Estimate sell return' })
  @ApiResponse({ status: 200, description: 'Sell estimate' })
  estimateSell(@Body() dto: EstimateSellDto) {
    if (dto.mu !== undefined && dto.sigma !== undefined) {
      return this.ammService.estimateDistributionSell(
        dto.marketId,
        dto.mu,
        dto.sigma,
        dto.amount,
      );
    }
    return this.ammService.estimateSell(
      dto.marketId,
      dto.outcome ?? 0,
      dto.amount,
    );
  }
}
