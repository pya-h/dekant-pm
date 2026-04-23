import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { MarketService } from './market.service';
import { CreateMarketDto } from './dto/create-market.dto';
import { MarketFilterDto } from './dto/market-filter.dto';
import { AuthGuard } from '../auth/guard/auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorator/roles.decorator';

@ApiTags('markets')
@Controller('markets')
export class MarketController {
  constructor(private readonly marketService: MarketService) {}

  @Get()
  @ApiOperation({ summary: 'List markets with filters' })
  @ApiResponse({ status: 200, description: 'Paginated market list' })
  findAll(@Query() filters: MarketFilterDto) {
    return this.marketService.findAll(filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get market by ID' })
  @ApiResponse({ status: 200, description: 'Market details' })
  @ApiResponse({ status: 404, description: 'Market not found' })
  findById(@Param('id', ParseIntPipe) id: number) {
    return this.marketService.findById(id);
  }

  @Get(':id/prices')
  @ApiOperation({ summary: 'Get current implied probabilities' })
  @ApiResponse({ status: 200, description: 'Probability array' })
  getPrices(@Param('id', ParseIntPipe) id: number) {
    return this.marketService.getPrices(id);
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Get trade history for a market' })
  @ApiResponse({ status: 200, description: 'Paginated trade list' })
  getHistory(
    @Param('id', ParseIntPipe) id: number,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.marketService.getHistory(
      id,
      Math.max(1, Number(page) || 1),
      Math.min(Math.max(1, Number(limit) || 50), 100),
    );
  }

  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('admin', 'creator')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create market metadata (Admin+)' })
  @ApiResponse({ status: 201, description: 'Market metadata created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  create(@Body() dto: CreateMarketDto) {
    return this.marketService.create(dto);
  }
}
