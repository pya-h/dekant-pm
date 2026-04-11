import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AmmService } from './amm.service';
import {
  EstimateBuyDto,
  EstimateBuyBySharesDto,
  EstimateSellDto,
  EstimateSellByCollateralDto,
} from './dto/amm.dto';

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

  @Post('estimate-buy-by-shares')
  @ApiOperation({ summary: 'Estimate collateral needed for desired shares' })
  @ApiResponse({ status: 200, description: 'Buy-by-shares estimate' })
  estimateBuyByShares(@Body() dto: EstimateBuyBySharesDto) {
    return this.ammService.estimateBuyByShares(
      dto.marketId,
      dto.outcome,
      dto.desiredTokens,
    );
  }

  @Post('estimate-sell-by-collateral')
  @ApiOperation({ summary: 'Estimate tokens needed for desired collateral' })
  @ApiResponse({ status: 200, description: 'Sell-by-collateral estimate' })
  estimateSellByCollateral(@Body() dto: EstimateSellByCollateralDto) {
    if (dto.mu !== undefined && dto.sigma !== undefined) {
      return this.ammService.estimateDistributionSellByCollateral(
        dto.marketId,
        dto.mu,
        dto.sigma,
        dto.desiredCollateral,
      );
    }
    return this.ammService.estimateSellByCollateral(
      dto.marketId,
      dto.outcome ?? 0,
      dto.desiredCollateral,
    );
  }
}
