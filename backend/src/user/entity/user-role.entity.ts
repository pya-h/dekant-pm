import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Unique,
} from 'typeorm';

@Entity('user_roles')
@Unique(['userAddress', 'role'])
export class UserRoleEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'varchar', length: 44, name: 'user_address' })
  userAddress!: string;

  @Column({ type: 'smallint' })
  role!: number;

  @Column({ type: 'varchar', length: 44, name: 'assigned_by' })
  assignedBy!: string;

  @Column({ type: 'timestamp', name: 'assigned_at' })
  assignedAt!: Date;
}
