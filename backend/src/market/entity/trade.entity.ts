import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { MarketEntity } from './market.entity';

@Entity('trades')
export class TradeEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'bigint', name: 'market_id' })
  @Index('idx_trades_market')
  marketId!: string;

  @ManyToOne(() => MarketEntity)
  @JoinColumn({ name: 'market_id' })
  market!: MarketEntity;

  @Column({ type: 'varchar', length: 44 })
  @Index('idx_trades_trader')
  trader!: string;

  @Column({ type: 'boolean', name: 'is_buy' })
  isBuy!: boolean;

  @Column({ type: 'bigint', name: 'collateral_amount' })
  collateralAmount!: string;

  @Column({ type: 'smallint', nullable: true, name: 'outcome_index' })
  outcomeIndex!: number | null;

  @Column({ type: 'bigint', nullable: true })
  mu!: string | null;

  @Column({ type: 'bigint', nullable: true })
  sigma!: string | null;

  @Column({ type: 'bigint', name: 'tokens_transacted' })
  tokensTransacted!: string;

  @Column({ type: 'bigint', name: 'fee_paid' })
  feePaid!: string;

  @Column({ type: 'varchar', length: 88, unique: true, name: 'tx_signature' })
  txSignature!: string;

  @Column({ type: 'bigint' })
  slot!: string;

  @Column({ type: 'timestamp' })
  timestamp!: Date;
}
