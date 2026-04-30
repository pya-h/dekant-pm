import { MigrationInterface, QueryRunner } from 'typeorm';

export class SetFeeInterval72h1714435200000 implements MigrationInterface {
  name = 'SetFeeInterval72h1714435200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE settings SET fee_collect_interval = '72h' WHERE is_active = true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE settings SET fee_collect_interval = 'none' WHERE is_active = true`,
    );
  }
}
