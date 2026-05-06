import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateFaucetConfigsSchema1714953600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add decimals column
    await queryRunner.query(`
      ALTER TABLE "faucet_configs"
      ADD COLUMN IF NOT EXISTS "decimals" SMALLINT NOT NULL DEFAULT 9
    `);

    // 2. Make label nullable (original migration had NOT NULL)
    await queryRunner.query(`
      ALTER TABLE "faucet_configs"
      ALTER COLUMN "label" DROP NOT NULL
    `);

    // 3. Change amount columns from BIGINT to VARCHAR(32)
    //    Existing BIGINT values are cast to their string representation.
    await queryRunner.query(`
      ALTER TABLE "faucet_configs"
      ALTER COLUMN "amount_per_request" TYPE VARCHAR(32)
      USING "amount_per_request"::TEXT
    `);

    await queryRunner.query(`
      ALTER TABLE "faucet_configs"
      ALTER COLUMN "max_daily_amount" TYPE VARCHAR(32)
      USING "max_daily_amount"::TEXT
    `);

    await queryRunner.query(`
      ALTER TABLE "faucet_configs"
      ALTER COLUMN "total_amount_sharable" TYPE VARCHAR(32)
      USING "total_amount_sharable"::TEXT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "faucet_configs"
      ALTER COLUMN "total_amount_sharable" TYPE BIGINT
      USING "total_amount_sharable"::BIGINT
    `);

    await queryRunner.query(`
      ALTER TABLE "faucet_configs"
      ALTER COLUMN "max_daily_amount" TYPE BIGINT
      USING "max_daily_amount"::BIGINT
    `);

    await queryRunner.query(`
      ALTER TABLE "faucet_configs"
      ALTER COLUMN "amount_per_request" TYPE BIGINT
      USING "amount_per_request"::BIGINT
    `);

    await queryRunner.query(`
      ALTER TABLE "faucet_configs"
      ALTER COLUMN "label" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "faucet_configs"
      DROP COLUMN IF EXISTS "decimals"
    `);
  }
}
