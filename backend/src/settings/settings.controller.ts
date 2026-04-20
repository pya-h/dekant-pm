import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  ParseIntPipe,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { IsOptional, IsIn, IsString, MaxLength } from 'class-validator';
import { AuthGuard } from '../auth/guard/auth.guard';
import {
  SettingsService,
  VALID_FEE_INTERVALS,
  VALID_DEADLINE_INTERVALS,
} from './settings.service';

class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @IsIn([...VALID_FEE_INTERVALS])
  feeCollectInterval?: string;

  @IsOptional()
  @IsIn([...VALID_DEADLINE_INTERVALS])
  deadlineCheckInterval?: string;
}

class CreateSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @IsIn([...VALID_FEE_INTERVALS])
  feeCollectInterval?: string;

  @IsOptional()
  @IsIn([...VALID_DEADLINE_INTERVALS])
  deadlineCheckInterval?: string;
}

function toResponse(s: { id: number; name: string; isActive: boolean; feeCollectInterval: string; deadlineCheckInterval: string }) {
  return {
    id: s.id,
    name: s.name,
    isActive: s.isActive,
    feeCollectInterval: s.feeCollectInterval,
    deadlineCheckInterval: s.deadlineCheckInterval,
  };
}

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get active protocol settings' })
  async getSettings() {
    const s = await this.settingsService.getActive();
    return toResponse(s);
  }

  @Get('all')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all settings presets' })
  async listAll() {
    const rows = await this.settingsService.listAll();
    return rows.map(toResponse);
  }

  @Post()
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new settings preset (inactive)' })
  async createSettings(@Body() dto: CreateSettingsDto) {
    const s = await this.settingsService.create(dto);
    return toResponse(s);
  }

  @Patch()
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update active protocol settings' })
  async updateSettings(@Body() dto: UpdateSettingsDto) {
    const s = await this.settingsService.update(dto);
    return toResponse(s);
  }

  @Post(':id/activate')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Activate a settings preset by ID' })
  async activate(@Param('id', ParseIntPipe) id: number) {
    const existing = await this.settingsService.getById(id);
    if (!existing) throw new NotFoundException('Settings preset not found');
    const s = await this.settingsService.activate(id);
    return toResponse(s);
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete an inactive settings preset' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    const existing = await this.settingsService.getById(id);
    if (!existing) throw new NotFoundException('Settings preset not found');
    if (existing.isActive) {
      throw new BadRequestException('Cannot delete the active settings preset');
    }
    await this.settingsService.remove(id);
    return { deleted: true };
  }
}
