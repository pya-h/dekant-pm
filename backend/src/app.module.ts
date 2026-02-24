import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { MarketModule } from './market/market.module';
import { IndexerModule } from './indexer/indexer.module';
import { AmmModule } from './amm/amm.module';
import { UserModule } from './user/user.module';
import { MarketEntity } from './market/market.entity';
import { TradeEntity } from './market/trade.entity';
import { UserPositionEntity } from './user/user-position.entity';
import { LpPositionEntity } from './user/lp-position.entity';
import { UserRoleEntity } from './user/user-role.entity';
import { IndexerStateEntity } from './indexer/indexer-state.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.get<string>('DATABASE_URL'),
        entities: [
          MarketEntity,
          TradeEntity,
          UserPositionEntity,
          LpPositionEntity,
          UserRoleEntity,
          IndexerStateEntity,
        ],
        synchronize: false,
        logging: config.get<string>('NODE_ENV') !== 'production',
      }),
    }),

    HealthModule,
    AuthModule,
    MarketModule,
    IndexerModule,
    AmmModule,
    UserModule,
  ],
})
export class AppModule {}
