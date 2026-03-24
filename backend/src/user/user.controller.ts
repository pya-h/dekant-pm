import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { UserService } from './user.service';
import { AuthGuard } from '../auth/guard/auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorator/roles.decorator';

@ApiTags('users')
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get(':address/market-position/:marketId')
  @ApiOperation({ summary: 'Get user position for a specific market' })
  @ApiResponse({ status: 200, description: 'User position or null' })
  getPositionByMarket(
    @Param('address') address: string,
    @Param('marketId') marketId: string,
  ) {
    return this.userService.getPositionByMarket(address, marketId);
  }

  @Get(':address/positions')
  @ApiOperation({ summary: 'Get user positions across all markets' })
  @ApiResponse({ status: 200, description: 'User positions' })
  getPositions(@Param('address') address: string) {
    return this.userService.getPositions(address);
  }

  @Get(':address/history')
  @ApiOperation({ summary: 'Get user trade history' })
  @ApiResponse({ status: 200, description: 'Paginated trade history' })
  getHistory(
    @Param('address') address: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.userService.getTradeHistory(
      address,
      Math.max(1, Number(page) || 1),
      Math.min(Math.max(1, Number(limit) || 50), 100),
    );
  }

  @Get(':address/lp-positions')
  @ApiOperation({ summary: 'Get user LP positions' })
  @ApiResponse({ status: 200, description: 'LP positions' })
  getLpPositions(@Param('address') address: string) {
    return this.userService.getLpPositions(address);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly userService: UserService) {}

  @Get('roles')
  @ApiOperation({ summary: 'List all role assignments' })
  @ApiResponse({ status: 200, description: 'Role list' })
  getRoles() {
    return this.userService.getRoles();
  }

  @Get('markets/stale')
  @ApiOperation({ summary: 'Markets pending resolution > 7 days' })
  @ApiResponse({ status: 200, description: 'Stale market list' })
  getStaleMarkets(@Query('days') days?: number) {
    return this.userService.getStaleMarkets(days ?? 7);
  }
}
