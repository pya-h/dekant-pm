import {
  Controller,
  Get,
  Post,
  Patch,
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
import { UpdateMarketMetadataDto } from './dto/update-market-metadata.dto';
import { AuthGuard } from '../auth/guard/auth.guard';
import { OptionalAuthGuard } from '../auth/guard/optional-auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorator/roles.decorator';
import { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { UserRoleEntity } from '../user/entity/user-role.entity';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';

const ADMIN_ROLE = 1;

@ApiTags('markets')
@Controller('markets')
export class MarketController {
  constructor(
    private readonly marketService: MarketService,
    @InjectRepository(UserRoleEntity)
    private readonly userRoleRepo: Repository<UserRoleEntity>,
    private readonly configService: ConfigService,
  ) {}

  private getWalletAddress(request: Request): string {
    const walletAddress = (request as any).walletAddress as string | undefined;
    if (!walletAddress) {
      throw new UnauthorizedException('Missing authenticated wallet address');
    }
    return walletAddress;
  }

  private async canEditAnyMarket(walletAddress: string): Promise<boolean> {
    const superadminAddress = this.configService
      .get<string>('SUPERADMIN_ADDRESS')
      ?.trim();
    if (superadminAddress && walletAddress === superadminAddress) {
      return true;
    }

    const adminRole = await this.userRoleRepo.findOne({
      where: { userAddress: walletAddress, role: ADMIN_ROLE },
      select: ['id'],
    });
    return !!adminRole;
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
  @ApiOperation({ summary: 'List current user bookmarked markets (auth)' })
  @ApiResponse({ status: 200, description: 'Bookmarked market list' })
  getMyBookmarks(@Req() request: Request) {
    return this.marketService.getBookmarkedMarkets(this.getWalletAddress(request));
  }

  @Get('bookmarks/wallet/:walletAddress')
  @ApiOperation({ summary: 'List bookmarked markets by wallet address (no auth)' })
  @ApiResponse({ status: 200, description: 'Bookmarked market list' })
  getBookmarksByWallet(@Param('walletAddress') walletAddress: string) {
    return this.marketService.getBookmarkedMarkets(walletAddress);
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

  @Get(':id/properties')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get extended market properties and stats (creator/admin only)' })
  @ApiResponse({ status: 200, description: 'Market properties with stats' })
  @ApiResponse({ status: 403, description: 'Not the creator or admin' })
  async getProperties(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: Request,
  ) {
    const walletAddress = this.getWalletAddress(request);
    const canEditAnyMarket = await this.canEditAnyMarket(walletAddress);
    return this.marketService.getMarketProperties(id, walletAddress, canEditAnyMarket);
  }

  @Get(':id/oracle-data')
  @ApiOperation({ summary: 'Get oracle-derived data (sample values for now)' })
  @ApiResponse({ status: 200, description: 'Distribution peak, ranges' })
  getOracleData(@Param('id', ParseIntPipe) id: number) {
    return this.marketService.getOracleData(id);
  }

  @Get(':id/history')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({ summary: 'Get trade history for a market' })
  @ApiResponse({ status: 200, description: 'Paginated trade list' })
  async getHistory(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: Request,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const callerWallet = (request as any).walletAddress as
      | string
      | undefined;
    const isPrivileged = callerWallet
      ? await this.canEditAnyMarket(callerWallet)
      : false;
    return this.marketService.getHistory(
      id,
      Math.max(1, Number(page) || 1),
      Math.min(Math.max(1, Number(limit) || 50), 100),
      callerWallet,
      isPrivileged,
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

  @Patch(':id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('admin', 'creator')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Update editable market metadata fields (category, subject, icon, tags)',
  })
  @ApiResponse({ status: 200, description: 'Market metadata updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async updateMetadata(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: Request,
    @Body() dto: UpdateMarketMetadataDto,
  ) {
    const walletAddress = this.getWalletAddress(request);
    const canEditAnyMarket = await this.canEditAnyMarket(walletAddress);
    return this.marketService.updateEditableMetadata(
      id,
      walletAddress,
      canEditAnyMarket,
      dto,
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
