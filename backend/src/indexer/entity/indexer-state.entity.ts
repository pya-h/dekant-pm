import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity('indexer_state')
export class IndexerStateEntity {
  @PrimaryColumn({ type: 'integer', default: 1 })
  id!: number;

  @Column({ type: 'bigint', default: 0, name: 'last_processed_slot' })
  lastProcessedSlot!: string;

  @UpdateDateColumn({ type: 'timestamp', name: 'last_processed_at' })
  lastProcessedAt!: Date;
}
