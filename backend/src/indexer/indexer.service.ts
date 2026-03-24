import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Connection, Logs, PublicKey } from '@solana/web3.js';
import { BorshCoder } from '@coral-xyz/anchor';
import { SOLANA_CONNECTION } from '../common/solana.provider';
import { IDL, PROGRAM_ID } from '../common/idl';
import {
  deriveMarket,
  deriveLpPosition,
  deriveProtocolConfig,
  deriveUserPosition,
} from '../common/pda';
import { IndexerStateEntity } from './entity/indexer-state.entity';
import { MarketEntity } from '../market/entity/market.entity';
import { TradeEntity } from '../market/entity/trade.entity';
import { UserPositionEntity } from '../user/entity/user-position.entity';
import { LpPositionEntity } from '../user/entity/lp-position.entity';
import { UserRoleEntity } from '../user/entity/user-role.entity';
import { parseEventsFromLogs, ParsedEvent } from './util/parser';

const MARKET_TYPE_NAMES: Record<number, string> = {
  0: 'Binary',
  1: 'Multi-outcome',
  2: 'Continuous',
};

@Injectable()
export class IndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IndexerService.name);
  private readonly coder = new BorshCoder(IDL as any);
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
    await this.syncAllMarkets();
    await this.syncAllPositions();
    await this.syncAllLpPositions();
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

  // ─── On-chain account fetching ──────────────────────────────────────────────

  /**
   * Fetch a market account from chain, decode it, and upsert into the DB.
   * This is the "plan B" — whenever we're unsure about DB state, we can
   * just re-sync from the source of truth.
   */
  private async fetchAndSyncMarket(marketId: number): Promise<void> {
    try {
      const [marketPda] = deriveMarket(PROGRAM_ID, marketId);
      const accountInfo = await this.connection.getAccountInfo(marketPda);
      if (!accountInfo) {
        this.logger.warn(`Market ${marketId} account not found on-chain`);
        return;
      }

      // BorshCoder returns snake_case field names and BN objects for numerics
      const d = this.coder.accounts.decode(
        'Market',
        accountInfo.data,
      ) as Record<string, any>;

      const numOutcomes = Number(d.num_outcomes);
      const state = Number(d.state);
      const reserves: string[] = [];
      for (let i = 0; i < numOutcomes; i++) {
        reserves.push(String(d.reserves[i]));
      }

      // If on-chain state is Active but deadline has passed, the market should
      // be PendingResolution. The on-chain program enforces this lazily (on next
      // trade), but we proactively reflect it in the DB so the frontend sees it.
      const deadline = new Date(Number(d.deadline) * 1000);
      const effectiveState =
        state === 0 && deadline.getTime() <= Date.now() ? 2 : state;

      const onChainFields = {
        pubkey: marketPda.toBase58(),
        marketType: Number(d.market_type),
        state: effectiveState,
        creator: d.creator.toString(),
        oracle: d.oracle.toString(),
        collateralMint: d.collateral_mint.toString(),
        deadline,
        numOutcomes,
        reserves,
        kSquared: String(d.k_squared),
        totalMinted: String(d.total_minted),
        protocolFeeAccumulated: String(d.protocol_fee_accumulated),
        lpFeeAccumulated: String(d.lp_fee_accumulated),
        lpSharesTotal: String(d.lp_shares_total),
        rangeMin: String(d.range_min),
        rangeMax: String(d.range_max),
        resolvedOutcome: effectiveState === 3 ? Number(d.resolved_outcome) : null,
        resolvedValue: effectiveState === 3 ? String(d.resolved_value) : null,
        resolvedAt: effectiveState === 3 ? new Date(Number(d.resolved_at) * 1000) : null,
      };

      const existing = await this.marketRepo.findOne({
        where: { id: String(marketId) },
      });

      if (existing) {
        await this.marketRepo.update(String(marketId), onChainFields);
      } else {
        const typeName = MARKET_TYPE_NAMES[Number(d.market_type)] ?? 'Unknown';
        const market = this.marketRepo.create({
          id: String(marketId),
          title: `${typeName} Market #${marketId}`,
          description: null,
          category: null,
          tags: null,
          imageUrl: null,
          outcomeLabels: null,
          ...onChainFields,
        });
        await this.marketRepo.save(market);
        this.logger.log(
          `Market ${marketId} inserted from on-chain data (no prior metadata)`,
        );
      }
    } catch (err) {
      this.logger.warn(`Failed to sync market ${marketId} from chain: ${err}`);
    }
  }

  /**
   * Sync all markets from on-chain state. Called on startup to catch any
   * markets created while the backend was down.
   */
  private async syncAllMarkets(): Promise<void> {
    this.logger.log('Syncing all markets from on-chain state...');
    try {
      const [configPda] = deriveProtocolConfig(PROGRAM_ID);
      const configInfo = await this.connection.getAccountInfo(configPda);
      if (!configInfo) {
        this.logger.log('Protocol not initialized yet, skipping market sync');
        return;
      }

      const config = this.coder.accounts.decode(
        'ProtocolConfig',
        configInfo.data,
      ) as Record<string, any>;
      const marketCount = Number(config.market_count);

      this.logger.log(`Found ${marketCount} markets on-chain, syncing...`);

      for (let i = 0; i < marketCount; i++) {
        await this.fetchAndSyncMarket(i);
      }

      this.logger.log(`Market sync complete (${marketCount} markets)`);
    } catch (err) {
      this.logger.warn(`Market sync failed: ${err}`);
    }
  }

  /**
   * Sync all on-chain user positions into the DB via getProgramAccounts.
   * Called on startup to catch positions created while the backend was down.
   */
  private async syncAllPositions(): Promise<void> {
    this.logger.log('Syncing all user positions from on-chain...');
    try {
      // UserPosition account discriminator (base58)
      const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
        filters: [{ memcmp: { offset: 0, bytes: 'j9SjDYAWesU' } }],
        commitment: 'confirmed',
      });

      let count = 0;
      for (const { account } of accounts) {
        try {
          const d = this.coder.accounts.decode(
            'UserPosition',
            account.data,
          ) as Record<string, any>;

          const marketPubkey = d.market.toString();
          // Resolve marketId from DB by pubkey
          const marketEntity = await this.marketRepo.findOne({
            where: { pubkey: marketPubkey },
          });
          if (!marketEntity) continue;

          const holdings: string[] = [];
          if (d.holdings) {
            for (const h of d.holdings) {
              holdings.push(String(h));
            }
          }

          await this.userPositionRepo.upsert(
            {
              marketId: marketEntity.id,
              userAddress: d.user.toString(),
              holdings,
              totalDeposited: String(d.total_deposited),
              totalWithdrawn: String(d.total_withdrawn),
              claimed: Boolean(d.claimed),
            },
            ['marketId', 'userAddress'],
          );
          count++;
        } catch {
          // Skip malformed accounts
        }
      }

      // Update totalTraders for each market based on synced positions
      const markets = await this.marketRepo.find({ select: ['id'] });
      for (const market of markets) {
        const traderCount = await this.userPositionRepo
          .createQueryBuilder('p')
          .select('COUNT(*)', 'count')
          .where('p.market_id = :id', { id: market.id })
          .getRawOne();
        await this.marketRepo.update(market.id, {
          totalTraders: Number(traderCount?.count ?? 0),
        });
      }

      this.logger.log(`Position sync complete (${count} positions)`);
    } catch (err) {
      this.logger.warn(`Position sync failed: ${err}`);
    }
  }

  // ─── Slot tracking ──────────────────────────────────────────────────────────

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

  // ─── Backfill ───────────────────────────────────────────────────────────────

  private async backfill(): Promise<void> {
    const lastSlot = await this.getLastProcessedSlot();
    this.logger.log(`Backfilling from slot ${lastSlot}...`);

    try {
      // Walk backwards through all signatures, paginating if > 1000
      const allSigs: { signature: string; slot: number }[] = [];
      let before: string | undefined;

      while (true) {
        const batch = await this.connection.getSignaturesForAddress(
          PROGRAM_ID,
          { limit: 1000, before },
          'confirmed',
        );
        if (batch.length === 0) break;

        const newInBatch = batch.filter((s) => (s.slot ?? 0) > lastSlot);
        for (const s of newInBatch) {
          allSigs.push({ signature: s.signature, slot: s.slot ?? 0 });
        }

        // If we filtered some out, we've reached already-processed territory
        if (newInBatch.length < batch.length) break;

        before = batch[batch.length - 1].signature;
      }

      // Process oldest first
      allSigs.reverse();

      this.logger.log(`Found ${allSigs.length} new transactions to process`);

      for (const sigInfo of allSigs) {
        try {
          const tx = await this.connection.getTransaction(sigInfo.signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
          });

          if (tx?.meta?.logMessages) {
            const events = parseEventsFromLogs(tx.meta.logMessages);
            for (const event of events) {
              await this.handleEvent(event, sigInfo.signature, sigInfo.slot);
            }
          }

          await this.updateLastProcessedSlot(sigInfo.slot);
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

  // ─── Live subscription ──────────────────────────────────────────────────────

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

  // ─── Health check ───────────────────────────────────────────────────────────

  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        const lastSlot = await this.getLastProcessedSlot();
        const currentSlot = await this.connection.getSlot();
        const lag = currentSlot - lastSlot;
        this.logger.debug(`Indexer health: lag=${lag} slots`);

        if (lag > 100) {
          this.logger.warn(`Indexer is ${lag} slots behind. Running sync + backfill.`);
          await this.syncAllMarkets();
          await this.backfill();
        }
      } catch (err) {
        this.logger.warn(`Health check failed: ${err}`);
      }
    }, 60_000);
  }

  // ─── Event dispatch ─────────────────────────────────────────────────────────

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

  // ─── Event handlers ─────────────────────────────────────────────────────────

  private async handleMarketCreated(
    data: Record<string, any>,
  ): Promise<void> {
    const marketId = Number(data.market_id);
    // Fetch full on-chain state (includes reserves, kSquared, totalMinted)
    await this.fetchAndSyncMarket(marketId);
    this.logger.log(`Market ${marketId} created/synced from on-chain`);
  }

  private async handleTradePlaced(
    data: Record<string, any>,
    txSignature: string,
    slot: number,
  ): Promise<void> {
    const marketId = String(data.market_id);
    const trader = data.trader.toString();

    const existingTrade = await this.tradeRepo.findOne({
      where: { txSignature },
    });
    if (existingTrade) return;

    const trade = this.tradeRepo.create({
      marketId,
      trader,
      isBuy: data.is_buy,
      collateralAmount: String(data.collateral_amount),
      outcomeIndex: data.outcome_index !== undefined ? Number(data.outcome_index) : null,
      mu: data.mu ? String(data.mu) : null,
      sigma: data.sigma ? String(data.sigma) : null,
      tokensTransacted: String(data.tokens_transacted),
      feePaid: String(data.fee_paid),
      txSignature,
      slot: String(slot),
      timestamp: new Date(Number(data.timestamp) * 1000),
    });
    await this.tradeRepo.save(trade);

    // Update volume + totalTraders (count distinct traders)
    const traderCount = await this.tradeRepo
      .createQueryBuilder('t')
      .select('COUNT(DISTINCT t.trader)', 'count')
      .where('t.market_id = :marketId', { marketId })
      .getRawOne();

    await this.marketRepo
      .createQueryBuilder()
      .update(MarketEntity)
      .set({
        totalVolume: () => 'total_volume + :collateralAmount',
        totalTraders: Number(traderCount?.count ?? 0),
        lastTradeAt: new Date(),
      })
      .setParameters({ collateralAmount: String(data.collateral_amount) })
      .where('id = :id', { id: marketId })
      .execute();

    // Refresh on-chain state (reserves, kSquared, totalMinted)
    await this.fetchAndSyncMarket(Number(data.market_id));

    // Sync user position from on-chain
    await this.fetchAndSyncUserPosition(
      Number(data.market_id),
      new PublicKey(trader),
    );

    this.logger.log(`Trade recorded for market ${marketId}: ${txSignature}`);
  }

  /**
   * Fetch a user_position account from chain and upsert into the DB.
   */
  private async fetchAndSyncUserPosition(
    marketId: number,
    user: PublicKey,
  ): Promise<void> {
    try {
      const [marketPda] = deriveMarket(PROGRAM_ID, marketId);
      const [positionPda] = deriveUserPosition(PROGRAM_ID, marketPda, user);

      const accountInfo = await this.connection.getAccountInfo(positionPda);
      if (!accountInfo) return;

      const d = this.coder.accounts.decode(
        'UserPosition',
        accountInfo.data,
      ) as Record<string, any>;

      const holdings: string[] = [];
      if (d.holdings) {
        for (const h of d.holdings) {
          holdings.push(String(h));
        }
      }

      await this.userPositionRepo.upsert(
        {
          marketId: String(marketId),
          userAddress: user.toBase58(),
          holdings,
          totalDeposited: String(d.total_deposited),
          totalWithdrawn: String(d.total_withdrawn),
          claimed: Boolean(d.claimed),
        },
        ['marketId', 'userAddress'],
      );
    } catch (err) {
      this.logger.warn(
        `Failed to sync user position for market ${marketId}, user ${user.toBase58()}: ${err}`,
      );
    }
  }

  /**
   * Fetch an lp_position account from chain and upsert into the DB.
   * If the account no longer exists (all shares removed), delete the DB row.
   */
  private async fetchAndSyncLpPosition(
    marketId: number,
    user: PublicKey,
  ): Promise<void> {
    try {
      const [marketPda] = deriveMarket(PROGRAM_ID, marketId);
      const [lpPda] = deriveLpPosition(PROGRAM_ID, marketPda, user);

      const accountInfo = await this.connection.getAccountInfo(lpPda);
      if (!accountInfo) {
        // Account closed (all shares removed) — remove from DB
        await this.lpPositionRepo.delete({
          marketId: String(marketId),
          userAddress: user.toBase58(),
        });
        return;
      }

      const d = this.coder.accounts.decode(
        'LpPosition',
        accountInfo.data,
      ) as Record<string, any>;

      await this.lpPositionRepo.upsert(
        {
          marketId: String(marketId),
          userAddress: user.toBase58(),
          shares: String(d.shares),
          depositedCollateral: String(d.deposited_collateral),
        },
        ['marketId', 'userAddress'],
      );
    } catch (err) {
      this.logger.warn(
        `Failed to sync LP position for market ${marketId}, user ${user.toBase58()}: ${err}`,
      );
    }
  }

  /**
   * Sync all on-chain LP positions into the DB via getProgramAccounts.
   * Called on startup to catch LP changes while the backend was down.
   */
  private async syncAllLpPositions(): Promise<void> {
    this.logger.log('Syncing all LP positions from on-chain...');
    try {
      // LpPosition account discriminator (base58): sha256("account:LpPosition")[0..8]
      const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
        filters: [
          { memcmp: { offset: 0, bytes: 'Jimf5pVB9RT' } },
        ],
        commitment: 'confirmed',
      });

      let count = 0;
      for (const { account } of accounts) {
        try {
          const d = this.coder.accounts.decode(
            'LpPosition',
            account.data,
          ) as Record<string, any>;

          const marketPubkey = d.market.toString();
          const marketEntity = await this.marketRepo.findOne({
            where: { pubkey: marketPubkey },
          });
          if (!marketEntity) continue;

          await this.lpPositionRepo.upsert(
            {
              marketId: marketEntity.id,
              userAddress: d.user.toString(),
              shares: String(d.shares),
              depositedCollateral: String(d.deposited_collateral),
            },
            ['marketId', 'userAddress'],
          );
          count++;
        } catch {
          // Skip malformed accounts
        }
      }

      this.logger.log(`LP position sync complete (${count} positions)`);
    } catch (err) {
      this.logger.warn(`LP position sync failed: ${err}`);
    }
  }

  private async handleMarketResolved(
    data: Record<string, any>,
  ): Promise<void> {
    await this.fetchAndSyncMarket(Number(data.market_id));
    this.logger.log(`Market ${data.market_id} resolved`);
  }

  private async handleMarketPaused(
    data: Record<string, any>,
  ): Promise<void> {
    await this.fetchAndSyncMarket(Number(data.market_id));
  }

  private async handleMarketUnpaused(
    data: Record<string, any>,
  ): Promise<void> {
    await this.fetchAndSyncMarket(Number(data.market_id));
  }

  private async handlePayoutClaimed(
    data: Record<string, any>,
  ): Promise<void> {
    await this.userPositionRepo.update(
      {
        marketId: String(data.market_id),
        userAddress: data.trader.toString(),
      },
      { claimed: true },
    );
  }

  private async handleLiquidityChanged(
    data: Record<string, any>,
  ): Promise<void> {
    // Refresh on-chain market state
    await this.fetchAndSyncMarket(Number(data.market_id));

    // Sync LP position from on-chain (source of truth for cumulative shares)
    await this.fetchAndSyncLpPosition(
      Number(data.market_id),
      new PublicKey(data.provider.toString()),
    );
  }

  private async handleRoleAssigned(
    data: Record<string, any>,
  ): Promise<void> {
    await this.userRoleRepo.upsert(
      {
        userAddress: data.user.toString(),
        role: Number(data.role),
        assignedBy: data.assigned_by.toString(),
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
}
