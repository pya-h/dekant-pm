import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFeeLpColumns1711670400000 implements MigrationInterface {
  name = 'AddFeeLpColumns1711670400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE markets ADD COLUMN IF NOT EXISTS protocol_fee_accumulated NUMERIC DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE markets ADD COLUMN IF NOT EXISTS lp_fee_accumulated NUMERIC DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE markets ADD COLUMN IF NOT EXISTS lp_shares_total NUMERIC DEFAULT '0'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE markets DROP COLUMN IF EXISTS lp_shares_total`,
    );
    await queryRunner.query(
      `ALTER TABLE markets DROP COLUMN IF EXISTS lp_fee_accumulated`,
    );
    await queryRunner.query(
      `ALTER TABLE markets DROP COLUMN IF EXISTS protocol_fee_accumulated`,
    );
  }
}
