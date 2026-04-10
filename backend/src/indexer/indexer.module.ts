import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IndexerService } from './indexer.service';
import { IndexerStateEntity } from './indexer-state.entity';
import { MarketEntity } from '../market/market.entity';
import { TradeEntity } from '../market/trade.entity';
import { UserPositionEntity } from '../user/user-position.entity';
import { LpPositionEntity } from '../user/lp-position.entity';
import { UserRoleEntity } from '../user/user-role.entity';
import { SolanaConnectionProvider } from '../common/solana.provider';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      IndexerStateEntity,
      MarketEntity,
      TradeEntity,
      UserPositionEntity,
      LpPositionEntity,
      UserRoleEntity,
    ]),
  ],
  providers: [SolanaConnectionProvider, IndexerService],
  exports: [IndexerService],
})
export class IndexerModule {}
