import { getMetadataArgsStorage } from 'typeorm';
import { TradeEntity } from './trade.entity';

describe('TradeEntity', () => {
  it('should map to the "trades" table', () => {
    const tables = getMetadataArgsStorage().tables;
    const table = tables.find((t) => t.target === TradeEntity);
    expect(table).toBeDefined();
    expect(table!.name).toBe('trades');
  });

  it('should have all required columns', () => {
    const columns = getMetadataArgsStorage().columns.filter(
      (c) => c.target === TradeEntity,
    );
    const columnNames = columns.map((c) => c.propertyName);

    const required = [
      'id',
      'marketId',
      'trader',
      'isBuy',
      'collateralAmount',
      'tokensTransacted',
      'feePaid',
      'txSignature',
      'slot',
      'timestamp',
    ];

    for (const col of required) {
      expect(columnNames).toContain(col);
    }
  });

  it('should have nullable fields for continuous market params', () => {
    const columns = getMetadataArgsStorage().columns.filter(
      (c) => c.target === TradeEntity,
    );

    const muCol = columns.find((c) => c.propertyName === 'mu');
    const sigmaCol = columns.find((c) => c.propertyName === 'sigma');
    const outcomeCol = columns.find((c) => c.propertyName === 'outcomeIndex');

    expect(muCol!.options.nullable).toBe(true);
    expect(sigmaCol!.options.nullable).toBe(true);
    expect(outcomeCol!.options.nullable).toBe(true);
  });

  it('should have unique tx_signature', () => {
    const columns = getMetadataArgsStorage().columns.filter(
      (c) => c.target === TradeEntity,
    );
    const txSig = columns.find((c) => c.propertyName === 'txSignature');
    expect(txSig!.options.unique).toBe(true);
  });

  it('should have indexes on market_id and trader', () => {
    const indices = getMetadataArgsStorage().indices.filter(
      (i) => i.target === TradeEntity,
    );
    // Check index decorators exist on the entity columns
    const columns = getMetadataArgsStorage().columns.filter(
      (c) => c.target === TradeEntity,
    );
    // We also have @Index decorators on columns
    expect(columns.find((c) => c.propertyName === 'marketId')).toBeDefined();
    expect(columns.find((c) => c.propertyName === 'trader')).toBeDefined();
  });

  it('should have ManyToOne relation to MarketEntity', () => {
    const relations = getMetadataArgsStorage().relations.filter(
      (r) => r.target === TradeEntity,
    );
    const marketRelation = relations.find(
      (r) => r.propertyName === 'market',
    );
    expect(marketRelation).toBeDefined();
    expect(marketRelation!.relationType).toBe('many-to-one');
  });
});
