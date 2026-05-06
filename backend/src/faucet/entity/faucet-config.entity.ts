import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('faucet_configs')
export class FaucetConfigEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  /** Token mint address or "native" for SOL */
  @Column({ type: 'varchar', length: 44, unique: true })
  token!: string;

  /** Human-readable label (e.g. "USDC", "SOL"). Falls back to token address if not set. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  label!: string | null;

  /** Token decimals (e.g. 9 for SOL, 6 for USDC) — used to convert amounts for on-chain transfers */
  @Column({ type: 'smallint', default: 9 })
  decimals!: number;

  /** Amount per request in human-readable units (e.g. "1.5" for 1.5 SOL) */
  @Column({ type: 'varchar', length: 32, name: 'amount_per_request' })
  amountPerRequest!: string;

  /** Max requests a single user can make per day */
  @Column({ type: 'int', name: 'max_requests_per_day', default: 3 })
  maxRequestsPerDay!: number;

  /** Max total amount sharable across ALL users per day (human-readable, optional) */
  @Column({ type: 'varchar', length: 32, name: 'max_daily_amount', nullable: true })
  maxDailyAmount!: string | null;

  /** Max total amount sharable across ALL time (human-readable, optional) */
  @Column({ type: 'varchar', length: 32, name: 'total_amount_sharable', nullable: true })
  totalAmountSharable!: string | null;

  /** Quick kill switch */
  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt!: Date;
}
