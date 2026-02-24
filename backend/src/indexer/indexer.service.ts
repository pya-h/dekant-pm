import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Connection, PublicKey, Logs } from '@solana/web3.js';
import { SOLANA_CONNECTION } from '../common/solana.provider';
import { PROGRAM_ID } from '../common/idl';
import { IndexerStateEntity } from './indexer-state.entity';
import { MarketEntity } from '../market/market.entity';
import { TradeEntity } from '../market/trade.entity';
import { UserPositionEntity } from '../user/user-position.entity';
import { LpPositionEntity } from '../user/lp-position.entity';
import { UserRoleEntity } from '../user/user-role.entity';
import { parseEventsFromLogs, ParsedEvent } from './parser';

@Injectable()
export class IndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IndexerService.name);
  private subscriptionId: number | null = null;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(SOLANA_CONNECTION)
    private readonly connection: Connection,
    @InjectRepository(IndexerStateEntity)
    private readonly indexerStateRepo: Repository<IndexerStateEntity>,
    @InjectRepository(MarketEntity)
    private readonly marketRepo: Repository<MarketEntity>,
    @InjectRepository(TradeEntity)
    private readonly tradeRepo: Repository<TradeEntity>,
    @InjectRepository(UserPositionEntity)
    private readonly userPositionRepo: Repository<UserPositionEntity>,
    @InjectRepository(LpPositionEntity)
    private readonly lpPositionRepo: Repository<LpPositionEntity>,
    @InjectRepository(UserRoleEntity)
    private readonly userRoleRepo: Repository<UserRoleEntity>,
  ) {}

  async onModuleInit() {
    this.logger.log('Starting indexer...');
    await this.backfill();
    this.subscribeToLogs();
    this.startHealthCheck();
  }

  onModuleDestroy() {
    if (this.subscriptionId !== null) {
      this.connection.removeOnLogsListener(this.subscriptionId);
      this.subscriptionId = null;
    }
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
  }

  private async getLastProcessedSlot(): Promise<number> {
    const state = await this.indexerStateRepo.findOne({ where: { id: 1 } });
    return state ? Number(state.lastProcessedSlot) : 0;
  }

  private async updateLastProcessedSlot(slot: number): Promise<void> {
    await this.indexerStateRepo.upsert(
      { id: 1, lastProcessedSlot: String(slot) },
      ['id'],
    );
  }

  private async backfill(): Promise<void> {
    const lastSlot = await this.getLastProcessedSlot();
    this.logger.log(`Backfilling from slot ${lastSlot}...`);

    try {
      const signatures = await this.connection.getSignaturesForAddress(
        PROGRAM_ID,
        { limit: 1000 },
        'confirmed',
      );

      // Filter to only process signatures after our last processed slot
      const newSigs = signatures
        .filter((sig) => (sig.slot ?? 0) > lastSlot)
        .reverse(); // oldest first

      this.logger.log(`Found ${newSigs.length} new transactions to process`);

      for (const sigInfo of newSigs) {
        try {
          const tx = await this.connection.getTransaction(sigInfo.signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
          });

          if (tx?.meta?.logMessages) {
            const events = parseEventsFromLogs(tx.meta.logMessages);
            for (const event of events) {
              await this.handleEvent(event, sigInfo.signature, sigInfo.slot ?? 0);
            }
          }

          await this.updateLastProcessedSlot(sigInfo.slot ?? 0);
        } catch (err) {
          this.logger.warn(
            `Failed to process tx ${sigInfo.signature}: ${err}`,
          );
        }
      }

      this.logger.log('Backfill complete');
    } catch (err) {
      this.logger.warn(`Backfill failed: ${err}`);
    }
  }

  private subscribeToLogs(): void {
    this.logger.log('Subscribing to program logs...');

    this.subscriptionId = this.connection.onLogs(
      PROGRAM_ID,
      async (logs: Logs) => {
        if (logs.err) return;

        try {
          const events = parseEventsFromLogs(logs.logs);
          for (const event of events) {
            await this.handleEvent(event, logs.signature, 0);
          }

          // Get slot from the signature
          const sigStatus = await this.connection.getSignatureStatus(
            logs.signature,
          );
          const slot = sigStatus?.value?.slot ?? 0;
          if (slot > 0) {
            await this.updateLastProcessedSlot(slot);
          }
        } catch (err) {
          this.logger.error(`Error processing log: ${err}`);
        }
      },
      'confirmed',
    );
  }

  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        const lastSlot = await this.getLastProcessedSlot();
        const currentSlot = await this.connection.getSlot();
        const lag = currentSlot - lastSlot;
        this.logger.debug(`Indexer health: lag=${lag} slots`);

        if (lag > 100) {
          this.logger.warn(`Indexer is ${lag} slots behind. Running backfill.`);
          await this.backfill();
        }
      } catch (err) {
        this.logger.warn(`Health check failed: ${err}`);
      }
    }, 60_000);
  }

  private async handleEvent(
    event: ParsedEvent,
    txSignature: string,
    slot: number,
  ): Promise<void> {
    this.logger.debug(`Processing event: ${event.name}`);

    switch (event.name) {
      case 'MarketCreated':
        await this.handleMarketCreated(event.data);
        break;
      case 'TradePlaced':
        await this.handleTradePlaced(event.data, txSignature, slot);
        break;
      case 'MarketResolved':
        await this.handleMarketResolved(event.data);
        break;
      case 'MarketPaused':
        await this.handleMarketPaused(event.data);
        break;
      case 'MarketUnpaused':
        await this.handleMarketUnpaused(event.data);
        break;
      case 'PayoutClaimed':
        await this.handlePayoutClaimed(event.data);
        break;
      case 'LiquidityChanged':
        await this.handleLiquidityChanged(event.data);
        break;
      case 'RoleAssigned':
        await this.handleRoleAssigned(event.data);
        break;
      case 'RoleRevoked':
        await this.handleRoleRevoked(event.data);
        break;
      default:
        this.logger.debug(`Unhandled event: ${event.name}`);
    }
  }

  private async handleMarketCreated(
    data: Record<string, any>,
  ): Promise<void> {
    const marketId = String(data.marketId);

    // Upsert on-chain fields only; metadata comes from B-5 POST /markets
    await this.marketRepo
      .createQueryBuilder()
      .update(MarketEntity)
      .set({
        marketType: Number(data.marketType),
        state: 0,
        creator: data.creator.toString(),
        oracle: data.oracle.toString(),
        collateralMint: data.collateralMint.toString(),
        deadline: new Date(Number(data.deadline) * 1000),
        numOutcomes: Number(data.numOutcomes),
        rangeMin: String(data.rangeMin),
        rangeMax: String(data.rangeMax),
      })
      .where('id = :id', { id: marketId })
      .execute();

    this.logger.log(`Market ${marketId} created/updated from on-chain event`);
  }

  private async handleTradePlaced(
    data: Record<string, any>,
    txSignature: string,
    slot: number,
  ): Promise<void> {
    const marketId = String(data.marketId);

    // Insert trade record
    const existingTrade = await this.tradeRepo.findOne({
      where: { txSignature },
    });
    if (existingTrade) return; // idempotent

    const trade = this.tradeRepo.create({
      marketId,
      trader: data.trader.toString(),
      isBuy: data.isBuy,
      collateralAmount: String(data.collateralAmount),
      outcomeIndex: data.outcomeIndex !== undefined ? Number(data.outcomeIndex) : null,
      mu: data.mu ? String(data.mu) : null,
      sigma: data.sigma ? String(data.sigma) : null,
      tokensTransacted: String(data.tokensTransacted),
      feePaid: String(data.feePaid),
      txSignature,
      slot: String(slot),
      timestamp: new Date(Number(data.timestamp) * 1000),
    });
    await this.tradeRepo.save(trade);

    // Update market volume
    await this.marketRepo
      .createQueryBuilder()
      .update(MarketEntity)
      .set({
        totalVolume: () =>
          `total_volume + ${data.collateralAmount}`,
        lastTradeAt: new Date(),
      })
      .where('id = :id', { id: marketId })
      .execute();

    // Refresh cached reserves from on-chain state
    await this.refreshMarketReserves(marketId);

    this.logger.log(`Trade recorded for market ${marketId}: ${txSignature}`);
  }

  private async handleMarketResolved(
    data: Record<string, any>,
  ): Promise<void> {
    const marketId = String(data.marketId);
    await this.marketRepo.update(marketId, {
      state: 3, // Resolved
      resolvedOutcome: Number(data.resolvedOutcome),
      resolvedValue: String(data.resolvedValue),
      resolvedAt: new Date(Number(data.timestamp) * 1000),
    });
    this.logger.log(`Market ${marketId} resolved`);
  }

  private async handleMarketPaused(
    data: Record<string, any>,
  ): Promise<void> {
    await this.marketRepo.update(String(data.marketId), { state: 1 });
  }

  private async handleMarketUnpaused(
    data: Record<string, any>,
  ): Promise<void> {
    await this.marketRepo.update(String(data.marketId), { state: 0 });
  }

  private async handlePayoutClaimed(
    data: Record<string, any>,
  ): Promise<void> {
    await this.userPositionRepo.update(
      {
        marketId: String(data.marketId),
        userAddress: data.trader.toString(),
      },
      { claimed: true },
    );
  }

  private async handleLiquidityChanged(
    data: Record<string, any>,
  ): Promise<void> {
    const marketId = String(data.marketId);
    const provider = data.provider.toString();

    if (data.isAdd) {
      await this.lpPositionRepo.upsert(
        {
          marketId,
          userAddress: provider,
          shares: String(data.sharesChanged),
          depositedCollateral: String(data.collateralAmount),
        },
        ['marketId', 'userAddress'],
      );
    }

    // Refresh cached reserves
    await this.refreshMarketReserves(marketId);
  }

  private async handleRoleAssigned(
    data: Record<string, any>,
  ): Promise<void> {
    await this.userRoleRepo.upsert(
      {
        userAddress: data.user.toString(),
        role: Number(data.role),
        assignedBy: data.assignedBy.toString(),
        assignedAt: new Date(Number(data.timestamp) * 1000),
      },
      ['userAddress', 'role'],
    );
  }

  private async handleRoleRevoked(
    data: Record<string, any>,
  ): Promise<void> {
    await this.userRoleRepo.delete({
      userAddress: data.user.toString(),
      role: Number(data.role),
    });
  }

  private async refreshMarketReserves(marketId: string): Promise<void> {
    // Fetch on-chain market account and update cached reserves
    try {
      const marketNum = Number(marketId);
      const buf = Buffer.alloc(8);
      buf.writeBigUInt64LE(BigInt(marketNum));

      const [marketPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('market'), buf],
        PROGRAM_ID,
      );

      const accountInfo = await this.connection.getAccountInfo(marketPda);
      if (!accountInfo) return;

      // Anchor discriminator is 8 bytes, then we need to parse the Market struct
      // For now, we log that a refresh was triggered — full parsing needs the IDL decoder
      this.logger.debug(`Refresh triggered for market ${marketId}`);
    } catch (err) {
      this.logger.warn(`Failed to refresh reserves for market ${marketId}: ${err}`);
    }
  }
}
