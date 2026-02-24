import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { ChallengeDto, VerifyDto } from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('challenge')
  @ApiOperation({ summary: 'Request authentication challenge' })
  @ApiResponse({ status: 201, description: 'Challenge created' })
  createChallenge(@Body() dto: ChallengeDto) {
    return this.authService.createChallenge(dto.walletAddress);
  }

  @Post('verify')
  @ApiOperation({ summary: 'Verify signed challenge and receive JWT' })
  @ApiResponse({ status: 201, description: 'JWT issued' })
  @ApiResponse({ status: 401, description: 'Invalid signature' })
  verify(@Body() dto: VerifyDto) {
    return this.authService.verifySignature(
      dto.walletAddress,
      dto.signature,
      dto.nonce,
    );
  }
}
