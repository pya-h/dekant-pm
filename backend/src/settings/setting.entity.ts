import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('settings')
export class SettingEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 64, default: 'default' })
  name!: string;

  @Column({ type: 'boolean', default: false, name: 'is_active' })
  isActive!: boolean;

  @Column({ type: 'varchar', length: 16, default: 'none', name: 'fee_collect_interval' })
  feeCollectInterval!: string;

  @Column({ type: 'varchar', length: 16, default: '1m', name: 'deadline_check_interval' })
  deadlineCheckInterval!: string;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt!: Date;
}
