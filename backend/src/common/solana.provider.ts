import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection } from '@solana/web3.js';

export const SOLANA_CONNECTION = 'SOLANA_CONNECTION';

export const SolanaConnectionProvider: Provider = {
  provide: SOLANA_CONNECTION,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Connection => {
    const rpcUrl = config.get<string>('SOLANA_RPC_URL', 'http://localhost:8899');
    return new Connection(rpcUrl, 'confirmed');
  },
};
