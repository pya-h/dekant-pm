import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MarketEntity } from './entity/market.entity';
import { TradeEntity } from './entity/trade.entity';
import { MarketService } from './market.service';
import { MarketController } from './market.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([MarketEntity, TradeEntity]), AuthModule],
  controllers: [MarketController],
  providers: [MarketService],
  exports: [MarketService],
})
export class MarketModule {}
