import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'varchar', length: 44, unique: true, name: 'wallet_address' })
  @Index('idx_users_wallet')
  walletAddress!: string;

  @Column({ type: 'varchar', length: 32, unique: true })
  @Index('idx_users_username')
  username!: string;

  @Column({ type: 'varchar', length: 255, nullable: true, unique: true })
  @Index('idx_users_email')
  email!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  avatar!: string | null;

  @Column({ type: 'smallint', name: 'tutorial_step_seen', default: 0 })
  tutorialStepSeen!: number;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt!: Date;
}
