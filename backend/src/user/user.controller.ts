import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { PublicKey } from '@solana/web3.js';
import { UserService } from './user.service';
import { AuthGuard } from '../auth/guard/auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorator/roles.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { Request } from 'express';

function validateAddress(address: string): void {
  try {
    new PublicKey(address);
  } catch {
    throw new BadRequestException(`Invalid wallet address: ${address}`);
  }
}

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
    validateAddress(address);
    return this.userService.getPositionByMarket(address, marketId);
  }

  @Get(':address/positions')
  @ApiOperation({ summary: 'Get user positions across all markets' })
  @ApiResponse({ status: 200, description: 'User positions' })
  getPositions(@Param('address') address: string) {
    validateAddress(address);
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
    validateAddress(address);
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
    validateAddress(address);
    return this.userService.getLpPositions(address);
  }
}

@ApiTags('profile')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('profile')
export class ProfileController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'User profile' })
  async getProfile(@Req() req: Request) {
    const walletAddress = (req as any).walletAddress as string;
    return this.userService.findOrCreateUser(walletAddress);
  }

  @Patch()
  @ApiOperation({ summary: 'Update current user profile' })
  @ApiResponse({ status: 200, description: 'Updated user profile' })
  async updateProfile(
    @Req() req: Request,
    @Body() dto: UpdateProfileDto,
  ) {
    const walletAddress = (req as any).walletAddress as string;
    return this.userService.updateProfile(walletAddress, dto);
  }

  @Patch('tutorial')
  @ApiOperation({ summary: 'Advance tutorial step seen' })
  @ApiResponse({ status: 200, description: 'Updated tutorial step' })
  async advanceTutorial(
    @Req() req: Request,
    @Body() body: { step: number },
  ) {
    const walletAddress = (req as any).walletAddress as string;
    return this.userService.advanceTutorial(walletAddress, body.step);
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
