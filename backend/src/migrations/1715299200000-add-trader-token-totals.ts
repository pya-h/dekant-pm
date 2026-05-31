import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mirrors on-chain `Market.trader_token_totals` (Vec<u64>) into the DB so the
 * frontend can estimate the resolution-time scaling factor pre-resolution.
 *
 * Backfill is handled by the next indexer pass — `fetchAndSyncMarket` upserts
 * this column from the decoded account. Default `'{}'` (empty bigint array)
 * keeps existing rows valid until the indexer rewrites them; an empty array
 * makes `scaling_factor = SCALE` (no dilution) in the estimator, so the
 * preview falls back to the pre-fix gross behavior until backfill runs.
 */
export class AddTraderTokenTotals1715299200000 implements MigrationInterface {
  name = 'AddTraderTokenTotals1715299200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE markets ADD COLUMN IF NOT EXISTS trader_token_totals BIGINT[] NOT NULL DEFAULT '{}'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE markets DROP COLUMN IF EXISTS trader_token_totals`,
    );
  }
}
