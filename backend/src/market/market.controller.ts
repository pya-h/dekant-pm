import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  ParseIntPipe,
  UnauthorizedException,
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
import { Request } from 'express';

@ApiTags('markets')
@Controller('markets')
export class MarketController {
  constructor(private readonly marketService: MarketService) {}

  private getWalletAddress(request: Request): string {
    const walletAddress = (request as any).walletAddress as string | undefined;
    if (!walletAddress) {
      throw new UnauthorizedException('Missing authenticated wallet address');
    }
    return walletAddress;
  }

  @Get()
  @ApiOperation({ summary: 'List markets with filters' })
  @ApiResponse({ status: 200, description: 'Paginated market list' })
  findAll(@Query() filters: MarketFilterDto) {
    return this.marketService.findAll(filters);
  }

  @Get('bookmarks/me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List current user bookmarked markets' })
  @ApiResponse({ status: 200, description: 'Bookmarked market list' })
  getMyBookmarks(@Req() request: Request) {
    return this.marketService.getBookmarkedMarkets(this.getWalletAddress(request));
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

  @Get(':id/oracle-data')
  @ApiOperation({ summary: 'Get oracle-derived data (sample values for now)' })
  @ApiResponse({ status: 200, description: 'Distribution peak, ranges' })
  getOracleData(@Param('id', ParseIntPipe) id: number) {
    return this.marketService.getOracleData(id);
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

  @Get(':id/bookmark')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get bookmark state for current user and market' })
  @ApiResponse({ status: 200, description: 'Bookmark state' })
  getBookmarkState(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: Request,
  ) {
    return this.marketService.getBookmarkState(id, this.getWalletAddress(request));
  }

  @Post(':id/bookmark')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add bookmark for current user and market' })
  @ApiResponse({ status: 200, description: 'Bookmark added' })
  addBookmark(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: Request,
  ) {
    return this.marketService.addBookmark(id, this.getWalletAddress(request));
  }

  @Delete(':id/bookmark')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove bookmark for current user and market' })
  @ApiResponse({ status: 200, description: 'Bookmark removed' })
  removeBookmark(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: Request,
  ) {
    return this.marketService.removeBookmark(id, this.getWalletAddress(request));
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
