import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { FaucetConfigEntity } from './faucet-config.entity';

@Entity('faucet_history')
export class FaucetHistoryEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  /** Receiver wallet address */
  @Column({ type: 'varchar', length: 44 })
  @Index('idx_faucet_history_receiver')
  receiver!: string;

  @Column({ type: 'bigint', name: 'config_id' })
  configId!: string;

  @ManyToOne(() => FaucetConfigEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'config_id' })
  config!: FaucetConfigEntity;

  /** Amount transferred (stored explicitly for historical accuracy) */
  @Column({ type: 'bigint' })
  amount!: string;

  /** On-chain transaction signature */
  @Column({ type: 'varchar', length: 128, name: 'tx_signature' })
  txSignature!: string;

  /** Whether the transfer succeeded */
  @Column({ type: 'varchar', length: 10, default: 'success' })
  status!: 'success' | 'failed';

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  @Index('idx_faucet_history_created_at')
  createdAt!: Date;
}
