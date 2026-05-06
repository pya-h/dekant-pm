import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPerformanceIndexes1714867200000 implements MigrationInterface {
  name = 'AddPerformanceIndexes1714867200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Market filter columns (used by findAll with category/subject/state/type filters)
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_markets_state ON markets(state)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_markets_category ON markets(category)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_markets_market_type ON markets(market_type)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_markets_creator ON markets(creator)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_markets_oracle ON markets(oracle)`);
    // Composite for the most common listing query: active markets sorted by newest
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_markets_state_created ON markets(state, created_at DESC)`);

    // User positions: queried by user_address for portfolio pages
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_user_positions_user_address ON user_positions(user_address)`);

    // LP positions: queried by user_address for portfolio pages
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_lp_positions_user_address ON lp_positions(user_address)`);

    // User roles: queried by user_address on every guarded request
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_user_roles_user_address ON user_roles(user_address)`);

    // Faucet history: composite for the rate-limiting count query
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_faucet_history_rate_limit ON faucet_history(config_id, receiver, created_at DESC)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_faucet_history_rate_limit`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_user_roles_user_address`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_lp_positions_user_address`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_user_positions_user_address`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_markets_state_created`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_markets_oracle`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_markets_creator`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_markets_market_type`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_markets_category`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_markets_state`);
  }
}
