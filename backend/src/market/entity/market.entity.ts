import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('markets')
export class MarketEntity {
  @PrimaryColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'varchar', length: 44, unique: true })
  pubkey!: string;

  @Column({ type: 'smallint', name: 'market_type' })
  marketType!: number;

  @Column({ type: 'smallint' })
  state!: number;

  @Column({ type: 'varchar', length: 44 })
  creator!: string;

  @Column({ type: 'varchar', length: 44 })
  oracle!: string;

  @Column({ type: 'varchar', length: 44, name: 'collateral_mint' })
  collateralMint!: string;

  @Column({ type: 'timestamp' })
  deadline!: Date;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'resolved_at' })
  resolvedAt!: Date | null;

  @Column({ type: 'smallint', name: 'num_outcomes' })
  numOutcomes!: number;

  // Off-chain metadata
  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, default: 'crypto' })
  category!: string | null;

  @Column({ type: 'varchar', length: 32, default: 'SOL' })
  subject!: string;

  @Column({ type: 'text', array: true, nullable: true })
  tags!: string[] | null;

  @Column({ type: 'text', nullable: true })
  icon!: string | null;

  @Column({ type: 'text', array: true, nullable: true, name: 'outcome_labels' })
  outcomeLabels!: string[] | null;

  // Cached on-chain state
  @Column({ type: 'bigint', array: true })
  reserves!: string[];

  @Column({ type: 'numeric', name: 'k_squared' })
  kSquared!: string;

  @Column({ type: 'numeric', name: 'total_minted' })
  totalMinted!: string;

  @Column({ type: 'smallint', nullable: true, name: 'resolved_outcome' })
  resolvedOutcome!: number | null;

  @Column({ type: 'bigint', nullable: true, name: 'resolved_value' })
  resolvedValue!: string | null;

  // Continuous market fields
  @Column({ type: 'bigint', nullable: true, name: 'range_min' })
  rangeMin!: string | null;

  @Column({ type: 'bigint', nullable: true, name: 'range_max' })
  rangeMax!: string | null;

  @Column({ type: 'smallint', default: 0, name: 'kernel_width' })
  kernelWidth!: number;

  @Column({ type: 'numeric', default: '0', name: 'scaling_factor' })
  scalingFactor!: string;

  // Aggregate trader holdings per outcome bin, mirrored from on-chain
  // Market.trader_token_totals. Used client-side to *estimate* the
  // resolution-time scaling factor for the trading preview (and any other
  // pre-resolution payout display). Empty array until the indexer first
  // syncs the market; never null.
  @Column({ type: 'bigint', array: true, default: '{}', name: 'trader_token_totals' })
  traderTokenTotals!: string[];

  // On-chain fee & LP tracking
  @Column({ type: 'numeric', default: '0', name: 'protocol_fee_accumulated' })
  protocolFeeAccumulated!: string;

  @Column({ type: 'numeric', default: '0', name: 'lp_fee_accumulated' })
  lpFeeAccumulated!: string;

  @Column({ type: 'numeric', default: '0', name: 'lp_shares_total' })
  lpSharesTotal!: string;

  // Derived / aggregated
  @Column({ type: 'numeric', default: 0, name: 'total_volume' })
  totalVolume!: string;

  @Column({ type: 'integer', default: 0, name: 'total_traders' })
  totalTraders!: number;

  @Column({ type: 'timestamp', nullable: true, name: 'last_trade_at' })
  lastTradeAt!: Date | null;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'boolean', default: false })
  archived!: boolean;
}
