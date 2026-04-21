import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSettingsTable1711584000000 implements MigrationInterface {
  name = 'AddSettingsTable1711584000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE settings (
        id                      SERIAL PRIMARY KEY,
        name                    VARCHAR(64) NOT NULL DEFAULT 'default',
        is_active               BOOLEAN NOT NULL DEFAULT TRUE,
        fee_collect_interval    VARCHAR(16) NOT NULL DEFAULT 'none',
        deadline_check_interval VARCHAR(16) NOT NULL DEFAULT '1m',
        created_at              TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at              TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS settings;`);
  }
}
