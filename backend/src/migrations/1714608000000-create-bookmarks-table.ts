import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBookmarksTable1714608000000 implements MigrationInterface {
  name = 'CreateBookmarksTable1714608000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS bookmarks (
        id BIGSERIAL PRIMARY KEY,
        market_id BIGINT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
        user_address VARCHAR(44) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(market_id, user_address)
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_bookmarks_user_address
      ON bookmarks(user_address);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_bookmarks_market_id
      ON bookmarks(market_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS bookmarks;
    `);
  }
}
