import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ClaimFaucetDto {
  @ApiProperty({ description: 'Token mint address or "native" for SOL' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(44)
  token!: string;
}
