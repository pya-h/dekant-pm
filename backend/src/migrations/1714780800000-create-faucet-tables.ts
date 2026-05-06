import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFaucetTables1714780800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "faucet_configs" (
        "id"                    BIGSERIAL PRIMARY KEY,
        "token"                 VARCHAR(44) NOT NULL UNIQUE,
        "label"                 VARCHAR(32) NOT NULL,
        "amount_per_request"    BIGINT NOT NULL,
        "max_requests_per_day"  INT NOT NULL DEFAULT 3,
        "max_daily_amount"      BIGINT,
        "total_amount_sharable" BIGINT,
        "enabled"               BOOLEAN NOT NULL DEFAULT true,
        "created_at"            TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"            TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "faucet_history" (
        "id"           BIGSERIAL PRIMARY KEY,
        "receiver"     VARCHAR(44) NOT NULL,
        "config_id"    BIGINT NOT NULL REFERENCES "faucet_configs"("id") ON DELETE CASCADE,
        "amount"       BIGINT NOT NULL,
        "tx_signature" VARCHAR(128) NOT NULL,
        "status"       VARCHAR(10) NOT NULL DEFAULT 'success',
        "created_at"   TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_faucet_history_receiver" ON "faucet_history"("receiver")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_faucet_history_created_at" ON "faucet_history"("created_at")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_faucet_history_config_id" ON "faucet_history"("config_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "faucet_history"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "faucet_configs"`);
  }
}
