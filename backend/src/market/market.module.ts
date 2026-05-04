import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MarketEntity } from './entity/market.entity';
import { TradeEntity } from './entity/trade.entity';
import { MarketService } from './market.service';
import { MarketDeadlineService } from './market-deadline.service';
import { MarketController } from './market.controller';
import { FaucetController } from './faucet.controller';
import { AuthModule } from '../auth/auth.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([MarketEntity, TradeEntity]),
    AuthModule,
    SettingsModule,
  ],
  controllers: [MarketController, FaucetController],
  providers: [MarketService, MarketDeadlineService],
  exports: [MarketService],
})
export class MarketModule {}
