import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ description: 'Username (3-32 chars, alphanumeric + _ - .)' })
  @IsString()
  @IsOptional()
  @MinLength(3)
  @MaxLength(32)
  @Matches(/^[a-zA-Z0-9_\-\.]+$/, {
    message: 'Username can only contain letters, numbers, underscores, dashes, and dots',
  })
  username?: string;

  @ApiPropertyOptional({ description: 'Email address' })
  @IsEmail()
  @IsOptional()
  @MaxLength(255)
  email?: string | null;

  @ApiPropertyOptional({ description: 'Avatar URL' })
  @IsString()
  @IsOptional()
  @MaxLength(512)
  avatar?: string | null;
}
