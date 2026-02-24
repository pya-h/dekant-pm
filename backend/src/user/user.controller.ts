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
import { AuthGuard } from '../auth/auth.guard';

@ApiTags('users')
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

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
    return this.userService.getTradeHistory(address, page ?? 1, limit ?? 50);
  }

  @Get(':address/lp-positions')
  @ApiOperation({ summary: 'Get user LP positions' })
  @ApiResponse({ status: 200, description: 'LP positions' })
  getLpPositions(@Param('address') address: string) {
    return this.userService.getLpPositions(address);
  }
}

@ApiTags('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly userService: UserService) {}

  @Get('roles')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all role assignments' })
  @ApiResponse({ status: 200, description: 'Role list' })
  getRoles() {
    return this.userService.getRoles();
  }

  @Get('markets/stale')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Markets pending resolution > 7 days' })
  @ApiResponse({ status: 200, description: 'Stale market list' })
  getStaleMarkets(@Query('days') days?: number) {
    return this.userService.getStaleMarkets(days ?? 7);
  }
}
