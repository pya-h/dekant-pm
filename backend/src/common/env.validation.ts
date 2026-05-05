import { plainToInstance } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, validateSync } from 'class-validator';

class EnvironmentVariables {
  @IsString()
  @IsNotEmpty({ message: 'DATABASE_URL is required' })
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty({ message: 'JWT_SECRET is required' })
  JWT_SECRET!: string;

  @IsString()
  @IsNotEmpty({ message: 'SUPERADMIN_ADDRESS is required' })
  SUPERADMIN_ADDRESS!: string;

  @IsString()
  @IsOptional()
  MAX_FAUCETS_PER_DAY?: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const messages = errors
      .flatMap((e) => Object.values(e.constraints ?? {}))
      .join('\n  - ');
    throw new Error(`Environment validation failed:\n  - ${messages}`);
  }

  if (
    config.DB_SYNCHRONIZE === 'true' &&
    config.NODE_ENV === 'production'
  ) {
    throw new Error(
      'DB_SYNCHRONIZE=true is not allowed in production. Use migrations instead.',
    );
  }

  return config;
}
