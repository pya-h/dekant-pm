import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsersTable1714694400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id"              BIGSERIAL PRIMARY KEY,
        "wallet_address"  VARCHAR(44) NOT NULL UNIQUE,
        "username"        VARCHAR(32) NOT NULL UNIQUE,
        "email"           VARCHAR(255) UNIQUE,
        "avatar"          VARCHAR(512),
        "created_at"      TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"      TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`CREATE INDEX "idx_users_wallet" ON "users" ("wallet_address")`);
    await queryRunner.query(`CREATE INDEX "idx_users_username" ON "users" ("username")`);
    await queryRunner.query(`CREATE INDEX "idx_users_email" ON "users" ("email")`);

    // Backfill: create user rows for all existing wallet addresses
    await queryRunner.query(`
      INSERT INTO "users" ("wallet_address", "username")
      SELECT DISTINCT addr, 'user_' || substr(md5(random()::text), 1, 8)
      FROM (
        SELECT trader AS addr FROM trades
        UNION
        SELECT user_address AS addr FROM user_positions
        UNION
        SELECT user_address AS addr FROM lp_positions
        UNION
        SELECT user_address AS addr FROM user_roles
      ) existing_wallets
      ON CONFLICT ("wallet_address") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
  }
}
