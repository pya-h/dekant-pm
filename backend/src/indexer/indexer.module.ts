import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IndexerService } from './indexer.service';
import { IndexerStateEntity } from './entity/indexer-state.entity';
import { MarketEntity } from '../market/entity/market.entity';
import { TradeEntity } from '../market/entity/trade.entity';
import { UserPositionEntity } from '../user/entity/user-position.entity';
import { LpPositionEntity } from '../user/entity/lp-position.entity';
import { UserRoleEntity } from '../user/entity/user-role.entity';
import { UserEntity } from '../user/entity/user.entity';
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
      UserEntity,
    ]),
  ],
  providers: [SolanaConnectionProvider, IndexerService],
  exports: [IndexerService],
})
export class IndexerModule {}
