import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MarketEntity } from '../market/entity/market.entity';
import { SettingsModule } from '../settings/settings.module';
import { SolanaConnectionProvider } from '../common/solana.provider';
import { FeeCollectionService } from './fee-collection.service';

@Module({
  imports: [TypeOrmModule.forFeature([MarketEntity]), SettingsModule],
  providers: [SolanaConnectionProvider, FeeCollectionService],
  exports: [FeeCollectionService],
})
export class FeeCollectionModule {}
