import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  Unique,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { MarketEntity } from '../market/market.entity';

@Entity('lp_positions')
@Unique(['marketId', 'userAddress'])
export class LpPositionEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'bigint', name: 'market_id' })
  marketId!: string;

  @ManyToOne(() => MarketEntity)
  @JoinColumn({ name: 'market_id' })
  market!: MarketEntity;

  @Column({ type: 'varchar', length: 44, name: 'user_address' })
  userAddress!: string;

  @Column({ type: 'numeric' })
  shares!: string;

  @Column({ type: 'bigint', default: 0, name: 'deposited_collateral' })
  depositedCollateral!: string;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt!: Date;
}
