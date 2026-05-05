import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { ChallengeDto, VerifyDto } from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
  ) {}

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
  async verify(@Body() dto: VerifyDto) {
    const result = this.authService.verifySignature(
      dto.walletAddress,
      dto.signature,
      dto.nonce,
    );

    // Ensure user row exists (create with random username if new)
    await this.userService.findOrCreateUser(dto.walletAddress);

    return result;
  }
}
