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

  /** Human-readable label (e.g. "USDC", "SOL") */
  @Column({ type: 'varchar', length: 32 })
  label!: string;

  /** Amount (in smallest unit / lamports) given per request */
  @Column({ type: 'bigint', name: 'amount_per_request' })
  amountPerRequest!: string;

  /** Max requests a single user can make per day */
  @Column({ type: 'int', name: 'max_requests_per_day', default: 3 })
  maxRequestsPerDay!: number;

  /** Max total amount sharable across ALL users per day (optional) */
  @Column({ type: 'bigint', name: 'max_daily_amount', nullable: true })
  maxDailyAmount!: string | null;

  /** Max total amount sharable across ALL time (optional) */
  @Column({ type: 'bigint', name: 'total_amount_sharable', nullable: true })
  totalAmountSharable!: string | null;

  /** Quick kill switch */
  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt!: Date;
}
