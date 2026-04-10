import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1708800000000 implements MigrationInterface {
  name = 'InitialSchema1708800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE markets (
        id                  BIGINT PRIMARY KEY,
        pubkey              VARCHAR(44) NOT NULL UNIQUE,
        market_type         SMALLINT NOT NULL,
        state               SMALLINT NOT NULL,
        creator             VARCHAR(44) NOT NULL,
        oracle              VARCHAR(44) NOT NULL,
        collateral_mint     VARCHAR(44) NOT NULL,
        deadline            TIMESTAMP NOT NULL,
        created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
        resolved_at         TIMESTAMP,
        num_outcomes        SMALLINT NOT NULL,

        title               TEXT NOT NULL,
        description         TEXT,
        category            VARCHAR(64),
        tags                TEXT[],
        image_url           TEXT,
        outcome_labels      TEXT[],

        reserves            BIGINT[] NOT NULL,
        k_squared           NUMERIC NOT NULL,
        total_minted        NUMERIC NOT NULL,
        resolved_outcome    SMALLINT,
        resolved_value      BIGINT,

        range_min           BIGINT,
        range_max           BIGINT,

        total_volume        NUMERIC DEFAULT 0,
        total_traders       INTEGER DEFAULT 0,
        last_trade_at       TIMESTAMP,
        updated_at          TIMESTAMP DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE trades (
        id                  BIGSERIAL PRIMARY KEY,
        market_id           BIGINT NOT NULL REFERENCES markets(id),
        trader              VARCHAR(44) NOT NULL,
        is_buy              BOOLEAN NOT NULL,
        collateral_amount   BIGINT NOT NULL,
        outcome_index       SMALLINT,
        mu                  BIGINT,
        sigma               BIGINT,
        tokens_transacted   BIGINT NOT NULL,
        fee_paid            BIGINT NOT NULL,
        tx_signature        VARCHAR(88) NOT NULL UNIQUE,
        slot                BIGINT NOT NULL,
        timestamp           TIMESTAMP NOT NULL
      );
    `);
    await queryRunner.query(`CREATE INDEX idx_trades_market ON trades(market_id);`);
    await queryRunner.query(`CREATE INDEX idx_trades_trader ON trades(trader);`);

    await queryRunner.query(`
      CREATE TABLE user_positions (
        id                  BIGSERIAL PRIMARY KEY,
        market_id           BIGINT NOT NULL REFERENCES markets(id),
        user_address        VARCHAR(44) NOT NULL,
        holdings            BIGINT[] NOT NULL,
        total_deposited     BIGINT NOT NULL DEFAULT 0,
        total_withdrawn     BIGINT NOT NULL DEFAULT 0,
        claimed             BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at          TIMESTAMP DEFAULT NOW(),
        UNIQUE(market_id, user_address)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE lp_positions (
        id                  BIGSERIAL PRIMARY KEY,
        market_id           BIGINT NOT NULL REFERENCES markets(id),
        user_address        VARCHAR(44) NOT NULL,
        shares              NUMERIC NOT NULL,
        deposited_collateral BIGINT NOT NULL DEFAULT 0,
        updated_at          TIMESTAMP DEFAULT NOW(),
        UNIQUE(market_id, user_address)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE indexer_state (
        id                  INTEGER PRIMARY KEY DEFAULT 1,
        last_processed_slot BIGINT NOT NULL DEFAULT 0,
        last_processed_at   TIMESTAMP DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      INSERT INTO indexer_state (id, last_processed_slot) VALUES (1, 0);
    `);

    await queryRunner.query(`
      CREATE TABLE user_roles (
        id                  BIGSERIAL PRIMARY KEY,
        user_address        VARCHAR(44) NOT NULL,
        role                SMALLINT NOT NULL,
        assigned_by         VARCHAR(44) NOT NULL,
        assigned_at         TIMESTAMP NOT NULL,
        UNIQUE(user_address, role)
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS user_roles;`);
    await queryRunner.query(`DROP TABLE IF EXISTS indexer_state;`);
    await queryRunner.query(`DROP TABLE IF EXISTS lp_positions;`);
    await queryRunner.query(`DROP TABLE IF EXISTS user_positions;`);
    await queryRunner.query(`DROP TABLE IF EXISTS trades;`);
    await queryRunner.query(`DROP TABLE IF EXISTS markets;`);
  }
}
