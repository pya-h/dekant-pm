import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the two on-chain fields the smooth-kernel resolution refactor introduces:
 *
 *   kernel_width    — smallint, 0..numBins-1; 0 means winner-take-all (legacy)
 *   scaling_factor  — numeric, SCALE-denominated (10^9); 0 until resolved
 *
 * Defaults of 0 / '0' match the on-chain values for every legacy row: existing
 * markets have `kernel_width = 0` (deserialised from the old `_padding=[0;30]`)
 * and `scaling_factor = 0` (the WTA branch in `resolve()` leaves it unset).
 * After this migration runs, the next indexer sync overwrites both columns
 * with the values borsh-decoded from the live Market account.
 */
export class AddKernelColumns1715212800000 implements MigrationInterface {
  name = 'AddKernelColumns1715212800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE markets ADD COLUMN IF NOT EXISTS kernel_width SMALLINT NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE markets ADD COLUMN IF NOT EXISTS scaling_factor NUMERIC NOT NULL DEFAULT '0'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE markets DROP COLUMN IF EXISTS scaling_factor`,
    );
    await queryRunner.query(
      `ALTER TABLE markets DROP COLUMN IF EXISTS kernel_width`,
    );
  }
}
