import { getMetadataArgsStorage } from 'typeorm';
import { UserPositionEntity } from './user-position.entity';
import { LpPositionEntity } from './lp-position.entity';
import { UserRoleEntity } from './user-role.entity';

describe('UserPositionEntity', () => {
  it('should map to "user_positions" table', () => {
    const table = getMetadataArgsStorage().tables.find(
      (t) => t.target === UserPositionEntity,
    );
    expect(table!.name).toBe('user_positions');
  });

  it('should have all required columns', () => {
    const columns = getMetadataArgsStorage().columns.filter(
      (c) => c.target === UserPositionEntity,
    );
    const names = columns.map((c) => c.propertyName);
    expect(names).toContain('id');
    expect(names).toContain('marketId');
    expect(names).toContain('userAddress');
    expect(names).toContain('holdings');
    expect(names).toContain('totalDeposited');
    expect(names).toContain('totalWithdrawn');
    expect(names).toContain('claimed');
  });

  it('should store holdings as bigint array', () => {
    const col = getMetadataArgsStorage().columns.find(
      (c) => c.target === UserPositionEntity && c.propertyName === 'holdings',
    );
    expect(col!.options.type).toBe('bigint');
    expect(col!.options.array).toBe(true);
  });

  it('should default claimed to false', () => {
    const col = getMetadataArgsStorage().columns.find(
      (c) => c.target === UserPositionEntity && c.propertyName === 'claimed',
    );
    expect(col!.options.default).toBe(false);
  });

  it('should have unique constraint on (market_id, user_address)', () => {
    const uniques = getMetadataArgsStorage().uniques.filter(
      (u) => u.target === UserPositionEntity,
    );
    expect(uniques.length).toBeGreaterThan(0);
  });

  it('should have ManyToOne relation to MarketEntity', () => {
    const relations = getMetadataArgsStorage().relations.filter(
      (r) => r.target === UserPositionEntity,
    );
    const marketRelation = relations.find((r) => r.propertyName === 'market');
    expect(marketRelation).toBeDefined();
    expect(marketRelation!.relationType).toBe('many-to-one');
  });
});

describe('LpPositionEntity', () => {
  it('should map to "lp_positions" table', () => {
    const table = getMetadataArgsStorage().tables.find(
      (t) => t.target === LpPositionEntity,
    );
    expect(table!.name).toBe('lp_positions');
  });

  it('should have all required columns', () => {
    const columns = getMetadataArgsStorage().columns.filter(
      (c) => c.target === LpPositionEntity,
    );
    const names = columns.map((c) => c.propertyName);
    expect(names).toContain('id');
    expect(names).toContain('marketId');
    expect(names).toContain('userAddress');
    expect(names).toContain('shares');
    expect(names).toContain('depositedCollateral');
  });

  it('should store shares as numeric', () => {
    const col = getMetadataArgsStorage().columns.find(
      (c) => c.target === LpPositionEntity && c.propertyName === 'shares',
    );
    expect(col!.options.type).toBe('numeric');
  });

  it('should have unique constraint on (market_id, user_address)', () => {
    const uniques = getMetadataArgsStorage().uniques.filter(
      (u) => u.target === LpPositionEntity,
    );
    expect(uniques.length).toBeGreaterThan(0);
  });
});

describe('UserRoleEntity', () => {
  it('should map to "user_roles" table', () => {
    const table = getMetadataArgsStorage().tables.find(
      (t) => t.target === UserRoleEntity,
    );
    expect(table!.name).toBe('user_roles');
  });

  it('should have all required columns', () => {
    const columns = getMetadataArgsStorage().columns.filter(
      (c) => c.target === UserRoleEntity,
    );
    const names = columns.map((c) => c.propertyName);
    expect(names).toContain('id');
    expect(names).toContain('userAddress');
    expect(names).toContain('role');
    expect(names).toContain('assignedBy');
    expect(names).toContain('assignedAt');
  });

  it('should store role as smallint', () => {
    const col = getMetadataArgsStorage().columns.find(
      (c) => c.target === UserRoleEntity && c.propertyName === 'role',
    );
    expect(col!.options.type).toBe('smallint');
  });

  it('should have unique constraint on (user_address, role)', () => {
    const uniques = getMetadataArgsStorage().uniques.filter(
      (u) => u.target === UserRoleEntity,
    );
    expect(uniques.length).toBeGreaterThan(0);
  });
});
