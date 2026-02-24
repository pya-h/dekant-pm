import { getMetadataArgsStorage } from 'typeorm';
import { IndexerStateEntity } from './indexer-state.entity';

describe('IndexerStateEntity', () => {
  it('should map to "indexer_state" table', () => {
    const table = getMetadataArgsStorage().tables.find(
      (t) => t.target === IndexerStateEntity,
    );
    expect(table!.name).toBe('indexer_state');
  });

  it('should have id, lastProcessedSlot columns', () => {
    const columns = getMetadataArgsStorage().columns.filter(
      (c) => c.target === IndexerStateEntity,
    );
    const names = columns.map((c) => c.propertyName);
    expect(names).toContain('id');
    expect(names).toContain('lastProcessedSlot');
  });

  it('should default lastProcessedSlot to 0', () => {
    const col = getMetadataArgsStorage().columns.find(
      (c) =>
        c.target === IndexerStateEntity &&
        c.propertyName === 'lastProcessedSlot',
    );
    expect(col!.options.default).toBe(0);
  });

  it('should use integer type for id', () => {
    const col = getMetadataArgsStorage().columns.find(
      (c) =>
        c.target === IndexerStateEntity && c.propertyName === 'id',
    );
    expect(col!.options.type).toBe('integer');
  });
});
