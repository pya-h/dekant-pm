import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTutorialStepSeen1715040000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "tutorial_step_seen" SMALLINT NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN IF EXISTS "tutorial_step_seen"
    `);
  }
}
