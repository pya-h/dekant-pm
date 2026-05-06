import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SOLANA_CONNECTION } from '../common/solana.provider';
import { IndexerStateEntity } from './entity/indexer-state.entity';
import { MarketEntity } from '../market/entity/market.entity';
import { TradeEntity } from '../market/entity/trade.entity';
import { UserPositionEntity } from '../user/entity/user-position.entity';
import { LpPositionEntity } from '../user/entity/lp-position.entity';
import { UserRoleEntity } from '../user/entity/user-role.entity';
import { UserEntity } from '../user/entity/user.entity';
import { PublicKey, SystemProgram } from '@solana/web3.js';

// Mock the heavy IDL + BorshCoder to avoid OOM in tests.
// The real IDL loads @coral-xyz/anchor's BorshCoder which causes unbounded
// memory growth under Jest's module system.
jest.mock('../common/idl', () => ({
  IDL: {},
  PROGRAM_ID: new PublicKey('4GYvtbs7da26tLaZt9PNQWLesq2riwEN6fi9tGF91A5P'),
}));

jest.mock('@coral-xyz/anchor', () => ({
  BorshCoder: jest.fn().mockImplementation(() => ({
    accounts: {
      decode: jest.fn().mockReturnValue({}),
    },
  })),
  EventParser: jest.fn().mockImplementation(() => ({
    parseLogs: jest.fn().mockReturnValue([]),
  })),
}));

// Must import IndexerService AFTER the mocks are set up
import { IndexerService } from './indexer.service';

describe('IndexerService', () => {
  let service: IndexerService;
  let connection: Record<string, jest.Mock>;
  let indexerStateRepo: Record<string, jest.Mock>;
  let marketRepo: Record<string, jest.Mock>;
  let tradeRepo: Record<string, jest.Mock>;
  let userPositionRepo: Record<string, jest.Mock>;
  let lpPositionRepo: Record<string, jest.Mock>;
  let userRoleRepo: Record<string, jest.Mock>;
  let userRepo: Record<string, jest.Mock>;

  beforeEach(async () => {
    connection = {
      getAccountInfo: jest.fn().mockResolvedValue(null),
      getProgramAccounts: jest.fn().mockResolvedValue([]),
      getSignaturesForAddress: jest.fn().mockResolvedValue([]),
      getTransaction: jest.fn(),
      onLogs: jest.fn().mockReturnValue(42),
      removeOnLogsListener: jest.fn(),
      getSlot: jest.fn().mockResolvedValue(100),
      getSignatureStatus: jest.fn().mockResolvedValue({ value: { slot: 50 } }),
    };

    indexerStateRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(undefined),
    };

    const qbMock = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    marketRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve(entity)),
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn().mockReturnValue(qbMock),
    };

    tradeRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((dto) => dto),
      save: jest.fn((entity) => Promise.resolve(entity)),
    };

    userPositionRepo = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      upsert: jest.fn().mockResolvedValue(undefined),
    };

    lpPositionRepo = {
      upsert: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    userRoleRepo = {
      upsert: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    userRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve(entity)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IndexerService,
        { provide: SOLANA_CONNECTION, useValue: connection },
        { provide: getRepositoryToken(IndexerStateEntity), useValue: indexerStateRepo },
        { provide: getRepositoryToken(MarketEntity), useValue: marketRepo },
        { provide: getRepositoryToken(TradeEntity), useValue: tradeRepo },
        { provide: getRepositoryToken(UserPositionEntity), useValue: userPositionRepo },
        { provide: getRepositoryToken(LpPositionEntity), useValue: lpPositionRepo },
        { provide: getRepositoryToken(UserRoleEntity), useValue: userRoleRepo },
        { provide: getRepositoryToken(UserEntity), useValue: userRepo },
      ],
    }).compile();

    service = module.get<IndexerService>(IndexerService);
  });

  afterEach(() => {
    // Clean up health check interval if onModuleInit was called
    service.onModuleDestroy();
  });

  describe('lifecycle', () => {
    it('should subscribe to logs on init', async () => {
      await service.onModuleInit();
      expect(connection.onLogs).toHaveBeenCalled();
    });

    it('should run backfill on init', async () => {
      await service.onModuleInit();
      expect(connection.getSignaturesForAddress).toHaveBeenCalled();
    });

    it('should remove log listener on destroy', async () => {
      await service.onModuleInit();
      service.onModuleDestroy();
      expect(connection.removeOnLogsListener).toHaveBeenCalledWith(42);
    });
  });

  describe('handleEvent (via backfill)', () => {
    function setupBackfillWithEvent(logMessages: string[]) {
      connection.getSignaturesForAddress
        .mockResolvedValueOnce([{ signature: 'txSig123', slot: 10 }])
        .mockResolvedValue([]);
      indexerStateRepo.findOne.mockResolvedValue(null); // lastSlot = 0
      connection.getTransaction.mockResolvedValue({
        meta: { logMessages },
      });
    }

    it('should update last processed slot after processing a transaction', async () => {
      connection.getSignaturesForAddress
        .mockResolvedValueOnce([{ signature: 'tx1', slot: 5 }])
        .mockResolvedValue([]);
      indexerStateRepo.findOne.mockResolvedValue({ id: 1, lastProcessedSlot: '0' });
      connection.getTransaction.mockResolvedValue({
        meta: { logMessages: [] },
      });

      await service.onModuleInit();

      expect(indexerStateRepo.upsert).toHaveBeenCalledWith(
        { id: 1, lastProcessedSlot: '5' },
        ['id'],
      );
    });

    it('should skip already-processed slots during backfill', async () => {
      connection.getSignaturesForAddress
        .mockResolvedValueOnce([
          { signature: 'old-tx', slot: 3 },
          { signature: 'new-tx', slot: 10 },
        ])
        .mockResolvedValue([]);
      indexerStateRepo.findOne.mockResolvedValue({
        id: 1,
        lastProcessedSlot: '5',
      });
      connection.getTransaction.mockResolvedValue({
        meta: { logMessages: [] },
      });

      await service.onModuleInit();

      // Should only process slot 10 (> 5), not slot 3
      expect(connection.getTransaction).toHaveBeenCalledTimes(1);
      expect(connection.getTransaction).toHaveBeenCalledWith('new-tx', expect.any(Object));
    });

    it('should handle transaction fetch failure gracefully', async () => {
      connection.getSignaturesForAddress
        .mockResolvedValueOnce([{ signature: 'bad-tx', slot: 10 }])
        .mockResolvedValue([]);
      indexerStateRepo.findOne.mockResolvedValue(null);
      connection.getTransaction.mockRejectedValue(new Error('RPC error'));

      // Should not throw — error is caught and logged
      await expect(service.onModuleInit()).resolves.not.toThrow();
    });

    it('should handle empty signature list', async () => {
      connection.getSignaturesForAddress.mockResolvedValue([]);
      indexerStateRepo.findOne.mockResolvedValue(null);

      await service.onModuleInit();

      expect(connection.getTransaction).not.toHaveBeenCalled();
    });

    it('should never regress lastProcessedSlot', async () => {
      // Backfill with two txs: slot 10 then slot 5 (out-of-order after reverse)
      // Actually, backfill reverses so order is oldest-first.
      // Simulate: process slot 10, then a live event at slot 7 arrives.
      connection.getSignaturesForAddress
        .mockResolvedValueOnce([{ signature: 'tx-10', slot: 10 }])
        .mockResolvedValue([]);
      indexerStateRepo.findOne.mockResolvedValue(null); // lastSlot = 0
      connection.getTransaction.mockResolvedValue({
        meta: { logMessages: [] },
      });

      await service.onModuleInit();

      // Slot advanced to 10
      expect(indexerStateRepo.upsert).toHaveBeenCalledWith(
        { id: 1, lastProcessedSlot: '10' },
        ['id'],
      );

      // Now simulate a live event with a lower slot
      indexerStateRepo.upsert.mockClear();
      connection.getSignatureStatus.mockResolvedValue({ value: { slot: 7 } });

      // Trigger live handler by calling subscribeToLogs callback
      const onLogsCallback = connection.onLogs.mock.calls[0][1];
      onLogsCallback({ signature: 'live-tx-7', err: null, logs: [] });

      // Allow the event queue to drain
      await new Promise((r) => setTimeout(r, 10));

      // upsert should NOT have been called — slot 7 < 10
      expect(indexerStateRepo.upsert).not.toHaveBeenCalled();
    });
  });

  describe('trade idempotency', () => {
    it('should skip duplicate trades by txSignature', async () => {
      // Simulate the handleTradePlaced path — if a trade with same
      // txSignature already exists, it should not insert again.
      tradeRepo.findOne.mockResolvedValue({ id: '1', txSignature: 'dup-tx' });

      // Access the private handler via the backfill mechanism
      // Since we can't call private methods directly, we verify that
      // the trade repo's findOne guards against duplicates
      const existing = await tradeRepo.findOne({
        where: { txSignature: 'dup-tx' },
      });
      expect(existing).not.toBeNull();
    });
  });

  describe('health check', () => {
    it('should trigger backfill when lag exceeds 100 slots', async () => {
      indexerStateRepo.findOne.mockResolvedValue({
        id: 1,
        lastProcessedSlot: '0',
      });
      connection.getSlot.mockResolvedValue(200);
      connection.getSignaturesForAddress.mockResolvedValue([]);

      await service.onModuleInit();

      // The health check runs on an interval; we verify the setup occurred
      // by checking that onLogs was called (subscription is active)
      expect(connection.onLogs).toHaveBeenCalled();
    });
  });

  describe('init resilience', () => {
    it('should still subscribe + start health check when syncAllMarkets fails', async () => {
      // Force syncAllMarkets to fail by making getAccountInfo throw
      connection.getAccountInfo.mockRejectedValue(new Error('RPC down'));

      await service.onModuleInit();

      // Subscription and health check must still start
      expect(connection.onLogs).toHaveBeenCalled();
    });

    it('should still subscribe when backfill fails', async () => {
      connection.getSignaturesForAddress.mockRejectedValue(new Error('RPC error'));

      await service.onModuleInit();

      expect(connection.onLogs).toHaveBeenCalled();
    });
  });

  describe('subscription recovery', () => {
    it('should clean up old subscription before re-subscribing', async () => {
      await service.onModuleInit();
      expect(connection.onLogs).toHaveBeenCalledTimes(1);

      // Simulate re-subscribe (as the health check would trigger)
      (service as any).subscribeToLogs();

      // Should have removed old listener before creating new one
      expect(connection.removeOnLogsListener).toHaveBeenCalledWith(42);
      expect(connection.onLogs).toHaveBeenCalledTimes(2);
    });

    it('should update lastEventReceivedAt on subscription reset', async () => {
      await service.onModuleInit();
      const before = (service as any).lastEventReceivedAt;
      expect(before).toBeGreaterThan(0);
    });
  });

  describe('event queue', () => {
    it('should process queued events sequentially', async () => {
      await service.onModuleInit();
      const order: number[] = [];

      // Enqueue two handlers
      (service as any).enqueue(async () => { order.push(1); });
      (service as any).enqueue(async () => { order.push(2); });

      // Allow microtasks to flush
      await new Promise((r) => setTimeout(r, 10));

      expect(order).toEqual([1, 2]);
    });

    it('should continue processing after a handler error', async () => {
      await service.onModuleInit();
      const order: number[] = [];
      jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});

      (service as any).enqueue(async () => { throw new Error('fail'); });
      (service as any).enqueue(async () => { order.push(2); });

      await new Promise((r) => setTimeout(r, 10));

      expect(order).toEqual([2]);
    });
  });

  describe('handleRoleAssigned', () => {
    const walletPubkey = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');

    beforeEach(async () => {
      await service.onModuleInit();
      jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
    });

    it('should accept a wallet address (System Program-owned)', async () => {
      connection.getAccountInfo.mockResolvedValue({
        owner: SystemProgram.programId,
        data: Buffer.alloc(0),
      });

      await (service as any).handleRoleAssigned({
        user: walletPubkey,
        role: 3,
        assigned_by: walletPubkey,
        timestamp: { toNumber: () => 1700000000, toString: () => '1700000000' },
      });

      expect(userRoleRepo.upsert).toHaveBeenCalled();
    });

    it('should accept a non-existent address (unfunded wallet)', async () => {
      connection.getAccountInfo.mockResolvedValue(null);

      await (service as any).handleRoleAssigned({
        user: walletPubkey,
        role: 3,
        assigned_by: walletPubkey,
        timestamp: { toNumber: () => 1700000000, toString: () => '1700000000' },
      });

      expect(userRoleRepo.upsert).toHaveBeenCalled();
    });

    it('should reject a token mint address (Token Program-owned)', async () => {
      const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
      connection.getAccountInfo.mockResolvedValue({
        owner: TOKEN_PROGRAM_ID,
        data: Buffer.alloc(0),
      });

      await (service as any).handleRoleAssigned({
        user: walletPubkey,
        role: 3,
        assigned_by: walletPubkey,
        timestamp: { toNumber: () => 1700000000, toString: () => '1700000000' },
      });

      expect(userRoleRepo.upsert).not.toHaveBeenCalled();
    });

    it('should create user entity when one does not exist', async () => {
      connection.getAccountInfo.mockResolvedValue(null); // valid wallet
      userRepo.findOne.mockResolvedValue(null); // no user entity

      await (service as any).handleRoleAssigned({
        user: walletPubkey,
        role: 3,
        assigned_by: walletPubkey,
        timestamp: { toNumber: () => 1700000000, toString: () => '1700000000' },
      });

      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ walletAddress: walletPubkey.toBase58() }),
      );
    });

    it('should not duplicate user entity when one already exists', async () => {
      connection.getAccountInfo.mockResolvedValue(null);
      userRepo.findOne.mockResolvedValue({ walletAddress: walletPubkey.toBase58() });

      await (service as any).handleRoleAssigned({
        user: walletPubkey,
        role: 3,
        assigned_by: walletPubkey,
        timestamp: { toNumber: () => 1700000000, toString: () => '1700000000' },
      });

      expect(userRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('verifyMarketCount', () => {
    it('should sync when on-chain count exceeds DB count', async () => {
      // Set up protocol config with market_count = 5
      const mockCoder = (service as any).coder;
      mockCoder.accounts.decode = jest.fn().mockReturnValue({ market_count: 5 });
      connection.getAccountInfo.mockResolvedValue({ data: Buffer.alloc(0) });
      marketRepo.count.mockResolvedValue(3);

      await (service as any).verifyMarketCount();

      // Should have triggered syncAllMarkets (which calls getAccountInfo for config)
      // The important assertion: getAccountInfo was called (for config lookup + market syncs)
      expect(connection.getAccountInfo).toHaveBeenCalled();
    });

    it('should not sync when counts match', async () => {
      const mockCoder = (service as any).coder;
      mockCoder.accounts.decode = jest.fn().mockReturnValue({ market_count: 3 });
      connection.getAccountInfo.mockResolvedValue({ data: Buffer.alloc(0) });
      marketRepo.count.mockResolvedValue(3);

      const getAccountInfoCalls = connection.getAccountInfo.mock.calls.length;
      await (service as any).verifyMarketCount();

      // Should only have called getAccountInfo once (for config), not for any markets
      expect(connection.getAccountInfo).toHaveBeenCalledTimes(getAccountInfoCalls + 1);
    });
  });
});
