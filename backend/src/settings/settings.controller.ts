import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { IsOptional, IsIn } from 'class-validator';
import { AuthGuard } from '../auth/guard/auth.guard';
import { SettingsService, VALID_INTERVALS } from './settings.service';

class UpdateSettingsDto {
  @IsOptional()
  @IsIn([...VALID_INTERVALS])
  feeCollectInterval?: string;
}

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all protocol settings' })
  async getSettings() {
    const s = await this.settingsService.get();
    return { feeCollectInterval: s.feeCollectInterval };
  }

  @Patch()
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update protocol settings' })
  async updateSettings(@Body() dto: UpdateSettingsDto) {
    const s = await this.settingsService.update(dto);
    return { feeCollectInterval: s.feeCollectInterval };
  }
}
