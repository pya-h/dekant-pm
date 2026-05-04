import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Unique,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { MarketEntity } from './market.entity';

@Entity('bookmarks')
@Unique(['marketId', 'userAddress'])
export class BookmarkEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'bigint', name: 'market_id' })
  @Index('idx_bookmarks_market_id')
  marketId!: string;

  @ManyToOne(() => MarketEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'market_id' })
  market!: MarketEntity;

  @Column({ type: 'varchar', length: 44, name: 'user_address' })
  @Index('idx_bookmarks_user_address')
  userAddress!: string;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt!: Date;
}
