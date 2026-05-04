import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';

@ApiTags('faucet')
@Controller('faucet')
export class FaucetController {
  @Get('status')
  @ApiOperation({ summary: 'Check faucet claim availability (placeholder)' })
  @ApiResponse({ status: 200, description: 'Available claims count' })
  @ApiQuery({ name: 'address', required: true, description: 'User wallet address' })
  @ApiQuery({ name: 'token', required: true, description: 'Token symbol' })
  getStatus(
    @Query('address') address: string,
    @Query('token') token: string,
  ) {
    // Placeholder: return a random number 0–3 for available claims
    const availableClaims = Math.floor(Math.random() * 4);
    return { availableClaims, address, token };
  }
}
