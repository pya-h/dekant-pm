import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameImageToIconAddSubject1714521600000
  implements MigrationInterface
{
  name = 'RenameImageToIconAddSubject1714521600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'markets' AND column_name = 'image_url'
        ) THEN
          IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = 'markets' AND column_name = 'icon'
          ) THEN
            ALTER TABLE markets RENAME COLUMN image_url TO icon;
          ELSE
            UPDATE markets SET icon = COALESCE(icon, image_url);
            ALTER TABLE markets DROP COLUMN image_url;
          END IF;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE markets ADD COLUMN IF NOT EXISTS icon TEXT
    `);

    await queryRunner.query(`
      ALTER TABLE markets ADD COLUMN IF NOT EXISTS subject VARCHAR(32)
    `);

    await queryRunner.query(`
      UPDATE markets
      SET subject = 'SOL'
      WHERE subject IS NULL OR BTRIM(subject) = ''
    `);

    await queryRunner.query(`
      ALTER TABLE markets ALTER COLUMN subject SET DEFAULT 'SOL'
    `);

    await queryRunner.query(`
      ALTER TABLE markets ALTER COLUMN subject SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE markets ALTER COLUMN category SET DEFAULT 'crypto'
    `);

    await queryRunner.query(`
      UPDATE markets
      SET category = 'crypto'
      WHERE category IS NULL OR BTRIM(category) = ''
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE markets ALTER COLUMN category DROP DEFAULT
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'markets' AND column_name = 'icon'
        ) THEN
          IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = 'markets' AND column_name = 'image_url'
          ) THEN
            ALTER TABLE markets RENAME COLUMN icon TO image_url;
          ELSE
            UPDATE markets SET image_url = COALESCE(image_url, icon);
            ALTER TABLE markets DROP COLUMN icon;
          END IF;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'markets' AND column_name = 'subject'
        ) THEN
          ALTER TABLE markets ALTER COLUMN subject DROP DEFAULT;
          ALTER TABLE markets DROP COLUMN subject;
        END IF;
      END $$;
    `);
  }
}
