import { Module } from '@nestjs/common';
import { AmmService } from './amm.service';
import { AmmController } from './amm.controller';
import { MarketModule } from '../market/market.module';

@Module({
  imports: [MarketModule],
  controllers: [AmmController],
  providers: [AmmService],
  exports: [AmmService],
})
export class AmmModule {}
