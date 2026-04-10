import { ConfigService } from '@nestjs/config';
import { FactoryProvider } from '@nestjs/common';
import { Connection } from '@solana/web3.js';
import {
  SOLANA_CONNECTION,
  SolanaConnectionProvider,
} from './solana.provider';

const provider = SolanaConnectionProvider as FactoryProvider;

describe('SolanaConnectionProvider', () => {
  it('should provide SOLANA_CONNECTION token', () => {
    expect(provider.provide).toBe(SOLANA_CONNECTION);
  });

  it('should inject ConfigService', () => {
    expect(provider.inject).toEqual([ConfigService]);
  });

  it('should create a Connection with configured RPC URL', () => {
    const mockConfig = {
      get: jest.fn().mockReturnValue('https://api.devnet.solana.com'),
    } as unknown as ConfigService;

    const factory = (SolanaConnectionProvider as any).useFactory;
    const connection: Connection = factory(mockConfig);

    expect(connection).toBeInstanceOf(Connection);
    expect(mockConfig.get).toHaveBeenCalledWith(
      'SOLANA_RPC_URL',
      'http://localhost:8899',
    );
  });

  it('should default to localhost:8899 when env var is not set', () => {
    const mockConfig = {
      get: jest.fn().mockReturnValue('http://localhost:8899'),
    } as unknown as ConfigService;

    const factory = (SolanaConnectionProvider as any).useFactory;
    const connection: Connection = factory(mockConfig);

    expect(connection).toBeInstanceOf(Connection);
  });

  it('should use confirmed commitment level', () => {
    const mockConfig = {
      get: jest.fn().mockReturnValue('http://localhost:8899'),
    } as unknown as ConfigService;

    const factory = (SolanaConnectionProvider as any).useFactory;
    const connection: Connection = factory(mockConfig);

    expect(connection.commitment).toBe('confirmed');
  });
});
