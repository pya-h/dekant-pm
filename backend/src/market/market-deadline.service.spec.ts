import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MarketDeadlineService } from './market-deadline.service';
import { MarketEntity } from './entity/market.entity';
import { SettingsService, DEADLINE_INTERVAL_MS } from '../settings/settings.service';

describe('MarketDeadlineService', () => {
  let service: MarketDeadlineService;
  let settingsService: { getDeadlineCheckInterval: jest.Mock };
  let marketRepo: Record<string, jest.Mock>;

  beforeEach(async () => {
    settingsService = {
      getDeadlineCheckInterval: jest.fn().mockResolvedValue('1m'),
    };

    marketRepo = {
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn().mockReturnValue({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        whereInIds: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketDeadlineService,
        { provide: getRepositoryToken(MarketEntity), useValue: marketRepo },
        { provide: SettingsService, useValue: settingsService },
      ],
    }).compile();

    service = module.get<MarketDeadlineService>(MarketDeadlineService);
  });

  describe('tick', () => {
    it('should run sweep on first tick (lastCheckTime=0)', async () => {
      marketRepo.find.mockResolvedValue([]);
      await service.tick();
      expect(settingsService.getDeadlineCheckInterval).toHaveBeenCalled();
      expect(marketRepo.find).toHaveBeenCalled();
    });

    it('should skip when not enough time has elapsed', async () => {
      // First tick runs the sweep
      await service.tick();
      expect(marketRepo.find).toHaveBeenCalledTimes(1);

      // Second tick immediately after should be skipped (interval=1m)
      await service.tick();
      expect(marketRepo.find).toHaveBeenCalledTimes(1);
    });

    it('should respect the configured interval from settings', async () => {
      settingsService.getDeadlineCheckInterval.mockResolvedValue('30s');
      await service.tick();
      expect(settingsService.getDeadlineCheckInterval).toHaveBeenCalled();
      expect(marketRepo.find).toHaveBeenCalled();
    });

    it('should prevent concurrent execution via running guard', async () => {
      // Directly set running=true to simulate an in-progress sweep
      (service as any).running = true;

      await service.tick();

      // Should skip entirely — no settings check, no DB query
      expect(settingsService.getDeadlineCheckInterval).not.toHaveBeenCalled();
      expect(marketRepo.find).not.toHaveBeenCalled();
    });

    it('should recover from errors in closeExpiredMarkets', async () => {
      // Silence the expected error log
      jest.spyOn(service['logger'], 'error').mockImplementation(() => {});
      marketRepo.find.mockRejectedValueOnce(new Error('DB error'));
      // Should not throw
      await service.tick();

      // running flag should be reset, allowing next tick
      // Advance past the interval by resetting lastCheckTime
      (service as any).lastCheckTime = 0;
      marketRepo.find.mockResolvedValueOnce([]);
      await service.tick();
      expect(marketRepo.find).toHaveBeenCalledTimes(2);
    });
  });

  describe('closeExpiredMarkets', () => {
    it('should do nothing when no expired markets found', async () => {
      marketRepo.find.mockResolvedValue([]);
      await service.closeExpiredMarkets();
      expect(marketRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should transition expired active markets to PendingResolution (state=2)', async () => {
      const expiredMarkets = [
        { id: '1', title: 'Market A', deadline: new Date('2025-01-01') },
        { id: '2', title: 'Market B', deadline: new Date('2025-06-01') },
      ];
      marketRepo.find.mockResolvedValue(expiredMarkets);

      await service.closeExpiredMarkets();

      const qb = marketRepo.createQueryBuilder();
      expect(qb.whereInIds).toHaveBeenCalledWith(['1', '2']);
      expect(qb.set).toHaveBeenCalledWith({ state: 2 });
      expect(qb.execute).toHaveBeenCalled();
    });

    it('should query for state=0 (Active) markets with deadline <= now', async () => {
      marketRepo.find.mockResolvedValue([]);
      await service.closeExpiredMarkets();

      expect(marketRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            state: 0,
          }),
          select: ['id', 'title', 'deadline'],
        }),
      );
    });

    it('should handle a single expired market', async () => {
      marketRepo.find.mockResolvedValue([
        { id: '10', title: 'Solo Market', deadline: new Date('2024-01-01') },
      ]);

      await service.closeExpiredMarkets();

      const qb = marketRepo.createQueryBuilder();
      expect(qb.whereInIds).toHaveBeenCalledWith(['10']);
      expect(qb.execute).toHaveBeenCalled();
    });
  });

  describe('DEADLINE_INTERVAL_MS', () => {
    it('should have correct milliseconds for all intervals', () => {
      expect(DEADLINE_INTERVAL_MS['30s']).toBe(30_000);
      expect(DEADLINE_INTERVAL_MS['1m']).toBe(60_000);
      expect(DEADLINE_INTERVAL_MS['2m']).toBe(120_000);
      expect(DEADLINE_INTERVAL_MS['5m']).toBe(300_000);
      expect(DEADLINE_INTERVAL_MS['10m']).toBe(600_000);
    });
  });
});
