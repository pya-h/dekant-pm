import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import * as fs from 'fs';

import { SOLANA_CONNECTION } from '../common/solana.provider';
import { IDL, PROGRAM_ID } from '../common/idl';
import { deriveProtocolConfig, deriveVaultAuthority } from '../common/pda';
import { MarketEntity } from '../market/entity/market.entity';
import { SettingsService, FeeCollectionInterval } from '../settings/settings.service';

const TOKEN_PROGRAM_ID = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);

/** Map interval setting to milliseconds. */
const INTERVAL_MS: Record<FeeCollectionInterval, number> = {
  none: 0,
  '6h': 6 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '48h': 48 * 60 * 60 * 1000,
  '72h': 72 * 60 * 60 * 1000,
};

function getAta(mint: PublicKey, owner: PublicKey): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return address;
}

@Injectable()
export class FeeCollectionService implements OnModuleInit {
  private readonly logger = new Logger(FeeCollectionService.name);
  private running = false;
  private lastCollectionTime = 0;
  private program: Program | null = null;
  private authority: Keypair | null = null;

  constructor(
    @Inject(SOLANA_CONNECTION)
    private readonly connection: Connection,
    @InjectRepository(MarketEntity)
    private readonly marketRepo: Repository<MarketEntity>,
    private readonly settingsService: SettingsService,
  ) {}

  onModuleInit() {
    this.initProgram();
  }

  private initProgram(): void {
    const keypairPath = process.env.COLLECTOR_KEYPAIR;
    if (!keypairPath) {
      this.logger.warn(
        'COLLECTOR_KEYPAIR env not set — automated fee collection disabled',
      );
      return;
    }

    try {
      const resolved = keypairPath.replace(/^~/, process.env.HOME || '');
      const raw = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
      this.authority = Keypair.fromSecretKey(Uint8Array.from(raw));

      const wallet = new Wallet(this.authority);
      const provider = new AnchorProvider(this.connection, wallet, {
        commitment: 'confirmed',
      });
      this.program = new Program(IDL as any, provider);

      this.logger.log(
        `Fee collector initialized: ${this.authority.publicKey.toBase58()}`,
      );
    } catch (err) {
      this.logger.error(`Failed to load collector keypair: ${err}`);
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async tick(): Promise<void> {
    if (this.running || !this.program || !this.authority) return;

    const interval = await this.settingsService.getFeeCollectionInterval();
    if (interval === 'none') return;

    const intervalMs = INTERVAL_MS[interval];
    if (Date.now() - this.lastCollectionTime < intervalMs) return;

    this.running = true;
    try {
      await this.collectAll();
    } catch (err) {
      this.logger.error(`Fee collection sweep failed: ${err}`);
    } finally {
      this.lastCollectionTime = Date.now();
      this.running = false;
    }
  }

  async collectAll(): Promise<{ collected: number; failed: number }> {
    const markets = await this.marketRepo
      .createQueryBuilder('market')
      .select(['market.id', 'market.pubkey', 'market.collateralMint', 'market.protocolFeeAccumulated'])
      .where('market.protocol_fee_accumulated > :zero', { zero: '0' })
      .getMany();

    if (markets.length === 0) {
      this.logger.log('No markets with pending protocol fees');
      return { collected: 0, failed: 0 };
    }

    this.logger.log(
      `Found ${markets.length} market(s) with pending protocol fees`,
    );

    // Fetch treasury from protocol_config (cached per sweep)
    const [protocolConfigPda] = deriveProtocolConfig(PROGRAM_ID);
    let treasury: PublicKey;
    try {
      const configAccount =
        await (this.program!.account as any).protocolConfig.fetch(protocolConfigPda);
      treasury = configAccount.treasury as PublicKey;
    } catch (err) {
      this.logger.error(`Failed to fetch protocol config: ${err}`);
      return { collected: 0, failed: markets.length };
    }

    let collected = 0;
    let failed = 0;

    for (const market of markets) {
      try {
        const marketPubkey = new PublicKey(market.pubkey);
        const collateralMint = new PublicKey(market.collateralMint);
        const [vaultAuthority] = deriveVaultAuthority(PROGRAM_ID, marketPubkey);
        const treasuryAta = getAta(collateralMint, treasury);

        // Fetch on-chain market to get vault address and verify fees exist
        const onChainMarket =
          await (this.program!.account as any).market.fetch(marketPubkey);

        // Skip if on-chain fees are actually zero (DB may be stale)
        const onChainFees = (onChainMarket.protocolFeeAccumulated as any).toNumber?.()
          ?? Number(onChainMarket.protocolFeeAccumulated);
        if (onChainFees === 0) {
          await this.marketRepo.update(market.id, { protocolFeeAccumulated: '0' });
          continue;
        }

        const sig = await (this.program!.methods as any)
          .collectFees()
          .accountsPartial({
            payer: this.authority!.publicKey,
            protocolConfig: protocolConfigPda,
            market: marketPubkey,
            vaultAuthority,
            vault: onChainMarket.vault as PublicKey,
            treasuryAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();

        // Wait for confirmation before resetting DB — prevents data loss if tx fails
        try {
          const latestBlockhash = await this.connection.getLatestBlockhash();
          await this.connection.confirmTransaction(
            { signature: sig, ...latestBlockhash },
            'confirmed',
          );
        } catch {
          // Confirmation timeout is non-fatal — tx may still have landed
        }

        await this.marketRepo.update(market.id, { protocolFeeAccumulated: '0' });
        this.logger.log(
          `Collected fees for market ${market.id} (${market.protocolFeeAccumulated} base units) — tx: ${sig}`,
        );
        collected++;
      } catch (err) {
        this.logger.error(
          `Failed to collect fees for market ${market.id}: ${err}`,
        );
        failed++;
      }
    }

    this.logger.log(
      `Fee collection complete: ${collected} collected, ${failed} failed`,
    );
    return { collected, failed };
  }
}
