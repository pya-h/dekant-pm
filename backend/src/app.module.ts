import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { TypeOrmModule } from "@nestjs/typeorm";
import { validateEnv } from "./common/env.validation";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { MarketModule } from "./market/market.module";
import { IndexerModule } from "./indexer/indexer.module";
import { AmmModule } from "./amm/amm.module";
import { UserModule } from "./user/user.module";
import { SettingsModule } from "./settings/settings.module";
import { FeeCollectionModule } from "./fee-collection/fee-collection.module";
import { MarketEntity } from "./market/entity/market.entity";
import { TradeEntity } from "./market/entity/trade.entity";
import { BookmarkEntity } from "./market/entity/bookmark.entity";
import { UserPositionEntity } from "./user/entity/user-position.entity";
import { LpPositionEntity } from "./user/entity/lp-position.entity";
import { UserRoleEntity } from "./user/entity/user-role.entity";
import { UserEntity } from "./user/entity/user.entity";
import { IndexerStateEntity } from "./indexer/entity/indexer-state.entity";
import { SettingEntity } from "./settings/setting.entity";
import { LoggerModule } from "nestjs-pino";

const isInProduction = process.env.NODE_ENV === "production";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env",
      validate: validateEnv,
    }),

    LoggerModule.forRoot({
      pinoHttp: {
        level: isInProduction ? "info" : "debug",
        ...(!isInProduction
          ? {
              transport: {
                targets: [
                  { target: "pino-pretty", options: { colorize: true } },
                ],
              },
            }
          : {}),
      },
    }),
    ScheduleModule.forRoot(),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: "postgres" as const,
        url: config.get<string>("DATABASE_URL"),
        entities: [
          MarketEntity,
          TradeEntity,
          BookmarkEntity,
          UserPositionEntity,
          LpPositionEntity,
          UserRoleEntity,
          UserEntity,
          IndexerStateEntity,
          SettingEntity,
        ],
        // DB_SYNCHRONIZE=true auto-creates tables — ONLY safe for dev/Docker init.
        // In production, use migrations instead to avoid accidental schema changes.
        synchronize:
          config.get<string>("DB_SYNCHRONIZE") === "true" &&
          config.get<string>("NODE_ENV") !== "production",
        logging: config.get<string>("NODE_ENV") !== "production",
      }),
    }),

    HealthModule,
    AuthModule,
    MarketModule,
    IndexerModule,
    AmmModule,
    UserModule,
    SettingsModule,
    FeeCollectionModule,
  ],
})
export class AppModule {}
