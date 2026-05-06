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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { FaucetService } from './faucet.service';
import { CreateFaucetConfigDto } from './dto/create-faucet-config.dto';
import { UpdateFaucetConfigDto } from './dto/update-faucet-config.dto';
import { ClaimFaucetDto } from './dto/claim-faucet.dto';
import { AuthGuard } from '../auth/guard/auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorator/roles.decorator';
import { Request } from 'express';

@ApiTags('faucet')
@Controller('faucet')
export class FaucetController {
  constructor(private readonly faucetService: FaucetService) {}

  // ── Public endpoints ──────────────────────���─────────────────────

  @Get('status')
  @ApiOperation({ summary: 'Check faucet availability for a user + token' })
  @ApiQuery({ name: 'address', required: true })
  @ApiQuery({ name: 'token', required: true })
  getStatus(
    @Query('address') address: string,
    @Query('token') token: string,
  ) {
    return this.faucetService.getStatus(address, token);
  }

  @Get('status/all')
  @ApiOperation({ summary: 'Get faucet status for all tokens for a user' })
  @ApiQuery({ name: 'address', required: true })
  getAllStatuses(@Query('address') address: string) {
    return this.faucetService.getAllStatuses(address);
  }

  @Get('configs')
  @ApiOperation({ summary: 'List all faucet configs (public — shows available tokens)' })
  getConfigs() {
    return this.faucetService.getAllConfigs();
  }

  // ── Claim (authenticated user) ─────────────────────────────────

  @Post('claim')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Claim faucet tokens' })
  @ApiResponse({ status: 201, description: 'Tokens transferred' })
  @ApiResponse({ status: 400, description: 'Limit reached or invalid token' })
  @ApiResponse({ status: 503, description: 'Faucet service unavailable' })
  claim(@Req() req: Request, @Body() dto: ClaimFaucetDto) {
    const userAddress = (req as any).user?.walletAddress;
    return this.faucetService.claim(userAddress, dto.token);
  }

  // ── Admin CRUD ──────────────────────────────────────────────────

  @Post('configs')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('superadmin', 'admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a faucet config (admin)' })
  createConfig(@Body() dto: CreateFaucetConfigDto) {
    return this.faucetService.createConfig(dto);
  }

  @Patch('configs/:id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('superadmin', 'admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a faucet config (admin)' })
  updateConfig(@Param('id') id: string, @Body() dto: UpdateFaucetConfigDto) {
    return this.faucetService.updateConfig(id, dto);
  }

  @Delete('configs/:id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('superadmin', 'admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a faucet config (admin)' })
  deleteConfig(@Param('id') id: string) {
    return this.faucetService.deleteConfig(id);
  }
}
