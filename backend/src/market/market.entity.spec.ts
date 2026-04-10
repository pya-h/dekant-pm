import { getMetadataArgsStorage } from 'typeorm';
import { MarketEntity } from './market.entity';

describe('MarketEntity', () => {
  it('should be defined', () => {
    expect(MarketEntity).toBeDefined();
  });

  it('should map to the "markets" table', () => {
    const tables = getMetadataArgsStorage().tables;
    const table = tables.find((t) => t.target === MarketEntity);
    expect(table).toBeDefined();
    expect(table!.name).toBe('markets');
  });

  it('should have all required columns', () => {
    const columns = getMetadataArgsStorage().columns.filter(
      (c) => c.target === MarketEntity,
    );
    const columnNames = columns.map((c) => c.propertyName);

    const required = [
      'id',
      'pubkey',
      'marketType',
      'state',
      'creator',
      'oracle',
      'collateralMint',
      'deadline',
      'numOutcomes',
      'title',
      'reserves',
      'kSquared',
      'totalMinted',
      'totalVolume',
      'totalTraders',
    ];

    for (const col of required) {
      expect(columnNames).toContain(col);
    }
  });

  it('should have nullable columns for optional fields', () => {
    const columns = getMetadataArgsStorage().columns.filter(
      (c) => c.target === MarketEntity,
    );

    const nullableFields = [
      'description',
      'category',
      'tags',
      'imageUrl',
      'outcomeLabels',
      'resolvedAt',
      'resolvedOutcome',
      'resolvedValue',
      'rangeMin',
      'rangeMax',
      'lastTradeAt',
    ];

    for (const fieldName of nullableFields) {
      const col = columns.find((c) => c.propertyName === fieldName);
      expect(col).toBeDefined();
      expect(col!.options.nullable).toBe(true);
    }
  });

  it('should use pubkey as unique constraint', () => {
    const columns = getMetadataArgsStorage().columns.filter(
      (c) => c.target === MarketEntity,
    );
    const pubkeyCol = columns.find((c) => c.propertyName === 'pubkey');
    expect(pubkeyCol!.options.unique).toBe(true);
  });

  it('should store reserves as bigint array', () => {
    const columns = getMetadataArgsStorage().columns.filter(
      (c) => c.target === MarketEntity,
    );
    const reservesCol = columns.find((c) => c.propertyName === 'reserves');
    expect(reservesCol!.options.type).toBe('bigint');
    expect(reservesCol!.options.array).toBe(true);
  });

  it('should store k_squared and total_minted as numeric', () => {
    const columns = getMetadataArgsStorage().columns.filter(
      (c) => c.target === MarketEntity,
    );
    const kSquared = columns.find((c) => c.propertyName === 'kSquared');
    const totalMinted = columns.find((c) => c.propertyName === 'totalMinted');
    expect(kSquared!.options.type).toBe('numeric');
    expect(totalMinted!.options.type).toBe('numeric');
  });

  it('should have id as primary column', () => {
    const primaryColumns = getMetadataArgsStorage().columns.filter(
      (c) => c.target === MarketEntity && c.mode === 'regular',
    );
    const idCol = primaryColumns.find((c) => c.propertyName === 'id');
    expect(idCol).toBeDefined();
  });
});
