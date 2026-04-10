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

@Entity('user_positions')
@Unique(['marketId', 'userAddress'])
export class UserPositionEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'bigint', name: 'market_id' })
  marketId!: string;

  @ManyToOne(() => MarketEntity)
  @JoinColumn({ name: 'market_id' })
  market!: MarketEntity;

  @Column({ type: 'varchar', length: 44, name: 'user_address' })
  userAddress!: string;

  @Column({ type: 'bigint', array: true })
  holdings!: string[];

  @Column({ type: 'bigint', default: 0, name: 'total_deposited' })
  totalDeposited!: string;

  @Column({ type: 'bigint', default: 0, name: 'total_withdrawn' })
  totalWithdrawn!: string;

  @Column({ type: 'boolean', default: false })
  claimed!: boolean;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt!: Date;
}
