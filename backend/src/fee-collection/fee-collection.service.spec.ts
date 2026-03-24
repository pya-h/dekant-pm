// Set PROGRAM_ID before any imports that reference common/idl.ts
process.env.PROGRAM_ID = 'F7dR6Ho8aCm9SBD2aNfJChTdpQpNvPmKjXZGSfjLZHKL';

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FeeCollectionService } from './fee-collection.service';
import { MarketEntity } from '../market/entity/market.entity';
import { SettingsService } from '../settings/settings.service';
import { SOLANA_CONNECTION } from '../common/solana.provider';

describe('FeeCollectionService', () => {
  let service: FeeCollectionService;
  let settingsService: { getFeeCollectionInterval: jest.Mock };
  let marketRepo: Record<string, jest.Mock>;
  const mockConnection = {};

  beforeEach(async () => {
    // Clear COLLECTOR_KEYPAIR to ensure program is not loaded in tests
    delete process.env.COLLECTOR_KEYPAIR;

    settingsService = {
      getFeeCollectionInterval: jest.fn(),
    };

    marketRepo = {
      find: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeeCollectionService,
        { provide: SOLANA_CONNECTION, useValue: mockConnection },
        { provide: getRepositoryToken(MarketEntity), useValue: marketRepo },
        { provide: SettingsService, useValue: settingsService },
      ],
    }).compile();

    service = module.get<FeeCollectionService>(FeeCollectionService);
  });

  describe('tick', () => {
    it('should skip when interval is "none"', async () => {
      settingsService.getFeeCollectionInterval.mockResolvedValue('none');
      await service.tick();
      expect(marketRepo.find).not.toHaveBeenCalled();
    });

    it('should skip when program is not initialized (no keypair)', async () => {
      settingsService.getFeeCollectionInterval.mockResolvedValue('6h');
      await service.tick();
      // No program → early return before even checking interval
      expect(marketRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('collectAll', () => {
    it('should return zeros when no markets have fees', async () => {
      marketRepo.find.mockResolvedValue([]);
      const result = await service.collectAll();
      expect(result).toEqual({ collected: 0, failed: 0 });
    });
  });
});
