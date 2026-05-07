import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MarketEntity } from '../market/entity/market.entity';
import { PriceController } from './price.controller';
import { PriceService } from './price.service';

@Module({
  imports: [TypeOrmModule.forFeature([MarketEntity])],
  controllers: [PriceController],
  providers: [PriceService],
  exports: [PriceService],
})
export class PriceModule {}
