import { Keypair } from '@solana/web3.js';
import { MarketEntity } from '../../src/market/entity/market.entity';
import { TradeEntity } from '../../src/market/entity/trade.entity';

export function mockMarket(
  overrides: Partial<MarketEntity> = {},
): MarketEntity {
  return {
    id: '1',
    pubkey: 'MarketPk11111111111111111111111111111111111',
    marketType: 0,
    state: 0,
    creator: 'Creator1111111111111111111111111111111111111',
    oracle: 'Oracle11111111111111111111111111111111111111',
    collateralMint: 'Mint1111111111111111111111111111111111111111',
    deadline: new Date('2026-12-31'),
    createdAt: new Date('2025-01-01'),
    resolvedAt: null,
    numOutcomes: 2,
    title: 'Test Market',
    description: null,
    category: 'crypto',
    subject: 'SOL',
    tags: null,
    icon: null,
    outcomeLabels: ['Yes', 'No'],
    reserves: ['500000000', '500000000'],
    kSquared: '500000000000000000',
    totalMinted: '1000000000',
    resolvedOutcome: null,
    resolvedValue: null,
    rangeMin: null,
    rangeMax: null,
    totalVolume: '0',
    totalTraders: 0,
    lastTradeAt: null,
    protocolFeeAccumulated: '0',
    lpFeeAccumulated: '0',
    lpSharesTotal: '0',
    updatedAt: new Date(),
    ...overrides,
  } as MarketEntity;
}

export function mockTrade(
  overrides: Partial<TradeEntity> = {},
): TradeEntity {
  return {
    id: '1',
    marketId: '1',
    trader: 'Trader11111111111111111111111111111111111111',
    isBuy: true,
    collateralAmount: '1000',
    outcomeIndex: 0,
    mu: null,
    sigma: null,
    tokensTransacted: '950',
    feePaid: '3',
    txSignature: 'sig'.padEnd(88, '0'),
    slot: '100',
    timestamp: new Date('2025-06-01'),
    ...overrides,
  } as TradeEntity;
}

export function randomWallet(): string {
  return Keypair.generate().publicKey.toBase58();
}

export function randomAmount(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function randomString(len: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < len; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function validCreateDto(overrides: Record<string, any> = {}) {
  return {
    title: `Test Market ${randomString(8)}`,
    marketId: randomAmount(1, 99999),
    pubkey: randomWallet(),
    marketType: 0,
    numOutcomes: 2,
    creator: randomWallet(),
    oracle: randomWallet(),
    collateralMint: randomWallet(),
    deadline: '2026-12-31T00:00:00Z',
    ...overrides,
  };
}
