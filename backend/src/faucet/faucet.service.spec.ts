import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import {
  NotFoundException,
  ConflictException,
  ServiceUnavailableException,
  BadRequestException,
} from '@nestjs/common';
import { FaucetService } from './faucet.service';
import { FaucetConfigEntity } from './entity/faucet-config.entity';
import { FaucetHistoryEntity } from './entity/faucet-history.entity';

function mockConfig(overrides: Partial<FaucetConfigEntity> = {}): FaucetConfigEntity {
  return {
    id: '1',
    token: 'native',
    label: 'SOL',
    decimals: 9,
    amountPerRequest: '1',
    maxRequestsPerDay: 3,
    maxDailyAmount: null,
    totalAmountSharable: null,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as FaucetConfigEntity;
}

describe('FaucetService', () => {
  let service: FaucetService;
  let configRepo: Record<string, jest.Mock>;
  let historyRepo: Record<string, jest.Mock>;
  let historyQbMock: Record<string, jest.Mock>;

  beforeEach(async () => {
    historyQbMock = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ total: '0', count: '0' }),
    };

    configRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((dto: any) => ({ ...dto, id: '1', createdAt: new Date(), updatedAt: new Date() })),
      save: jest.fn((entity: any) => Promise.resolve({ ...entity, id: entity.id ?? '1' })),
      remove: jest.fn().mockResolvedValue(undefined),
    };

    historyRepo = {
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn().mockReturnValue(historyQbMock),
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve({ ...entity, id: '1' })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FaucetService,
        { provide: getRepositoryToken(FaucetConfigEntity), useValue: configRepo },
        { provide: getRepositoryToken(FaucetHistoryEntity), useValue: historyRepo },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'SOLANA_RPC_URL') return 'https://api.devnet.solana.com';
              return undefined; // no FAUCET_KEYPAIR → faucet unavailable
            }),
          },
        },
      ],
    }).compile();

    service = module.get<FaucetService>(FaucetService);
  });

  describe('getAllConfigs', () => {
    it('should return all configs ordered by createdAt DESC', async () => {
      const configs = [mockConfig({ id: '2' }), mockConfig({ id: '1' })];
      configRepo.find.mockResolvedValue(configs);

      const result = await service.getAllConfigs();
      expect(result).toBe(configs);
      expect(configRepo.find).toHaveBeenCalledWith({ order: { createdAt: 'DESC' } });
    });

    it('should return empty array when no configs exist', async () => {
      configRepo.find.mockResolvedValue([]);
      const result = await service.getAllConfigs();
      expect(result).toEqual([]);
    });
  });

  describe('createConfig', () => {
    it('should create a new config for native SOL', async () => {
      configRepo.findOne.mockResolvedValue(null);
      const dto = {
        token: 'native',
        amountPerRequest: '1',
        maxRequestsPerDay: 3,
      };

      const result = await service.createConfig(dto as any);

      expect(configRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'native',
          decimals: 9,
          amountPerRequest: '1',
          maxRequestsPerDay: 3,
          enabled: true,
        }),
      );
      expect(configRepo.save).toHaveBeenCalled();
      expect(result).toHaveProperty('token', 'native');
    });

    it('should throw ConflictException if config already exists', async () => {
      configRepo.findOne.mockResolvedValue(mockConfig());
      const dto = { token: 'native', amountPerRequest: '1', maxRequestsPerDay: 3 };

      await expect(service.createConfig(dto as any)).rejects.toThrow(ConflictException);
    });

    it('should set optional fields', async () => {
      configRepo.findOne.mockResolvedValue(null);
      const dto = {
        token: 'native',
        label: 'Solana',
        amountPerRequest: '2',
        maxRequestsPerDay: 5,
        maxDailyAmount: '100',
        totalAmountSharable: '1000',
        enabled: false,
      };

      await service.createConfig(dto as any);

      expect(configRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          label: 'Solana',
          maxDailyAmount: '100',
          totalAmountSharable: '1000',
          enabled: false,
        }),
      );
    });
  });

  describe('updateConfig', () => {
    it('should update fields that are provided', async () => {
      const config = mockConfig();
      configRepo.findOne.mockResolvedValue(config);

      const result = await service.updateConfig('1', {
        amountPerRequest: '2',
        maxRequestsPerDay: 5,
        enabled: false,
      });

      expect(configRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          amountPerRequest: '2',
          maxRequestsPerDay: 5,
          enabled: false,
        }),
      );
    });

    it('should throw NotFoundException if config does not exist', async () => {
      configRepo.findOne.mockResolvedValue(null);
      await expect(service.updateConfig('999', { enabled: false })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should null out optional fields when set to empty', async () => {
      const config = mockConfig({
        label: 'Old Label',
        maxDailyAmount: '100',
        totalAmountSharable: '1000',
      });
      configRepo.findOne.mockResolvedValue(config);

      await service.updateConfig('1', {
        label: '',
        maxDailyAmount: null,
        totalAmountSharable: null,
      });

      expect(configRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          label: null,
          maxDailyAmount: null,
          totalAmountSharable: null,
        }),
      );
    });
  });

  describe('deleteConfig', () => {
    it('should delete an existing config', async () => {
      const config = mockConfig();
      configRepo.findOne.mockResolvedValue(config);

      await service.deleteConfig('1');
      expect(configRepo.remove).toHaveBeenCalledWith(config);
    });

    it('should throw NotFoundException if config does not exist', async () => {
      configRepo.findOne.mockResolvedValue(null);
      await expect(service.deleteConfig('999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getStatus', () => {
    it('should return unavailable when faucet keypair is not set', async () => {
      const result = await service.getStatus('SomeWallet', 'native');
      expect(result.available).toBe(false);
      expect(result.reason).toContain('unavailable');
    });

    it('should return unavailable when config not found', async () => {
      // Override to simulate keypair loaded
      (service as any).faucetKeypair = { publicKey: { toBase58: () => 'fake' } };
      configRepo.findOne.mockResolvedValue(null);

      const result = await service.getStatus('SomeWallet', 'unknown-token');
      expect(result.available).toBe(false);
      expect(result.reason).toContain('not configured');
    });
  });

  describe('getAllStatuses', () => {
    it('should return empty array when keypair not set', async () => {
      const result = await service.getAllStatuses('SomeWallet');
      expect(result).toEqual([]);
    });

    it('should return empty when no enabled configs', async () => {
      (service as any).faucetKeypair = { publicKey: { toBase58: () => 'fake' } };
      configRepo.find.mockResolvedValue([]);

      const result = await service.getAllStatuses('SomeWallet');
      expect(result).toEqual([]);
    });
  });

  describe('claim', () => {
    it('should throw ServiceUnavailableException when keypair not set', async () => {
      await expect(service.claim('SomeWallet', 'native')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('should throw BadRequestException when config not found', async () => {
      (service as any).faucetKeypair = { publicKey: { toBase58: () => 'fake' } };
      configRepo.findOne.mockResolvedValue(null);

      await expect(service.claim('SomeWallet', 'unknown')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('supportingSolLamports', () => {
    async function buildServiceWith(envValue: string | undefined) {
      const mod = await Test.createTestingModule({
        providers: [
          FaucetService,
          { provide: getRepositoryToken(FaucetConfigEntity), useValue: configRepo },
          { provide: getRepositoryToken(FaucetHistoryEntity), useValue: historyRepo },
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                if (key === 'SOLANA_RPC_URL') return 'https://api.devnet.solana.com';
                if (key === 'SUPPORTING_SOL_FAUCET') return envValue;
                return undefined;
              }),
            },
          },
        ],
      }).compile();
      return mod.get<FaucetService>(FaucetService);
    }

    it('should default to 0.03 SOL (30_000_000 lamports) when env not set', async () => {
      const svc = await buildServiceWith(undefined);
      expect((svc as any).supportingSolLamports).toBe(BigInt(30_000_000));
    });

    it('should parse custom value', async () => {
      const svc = await buildServiceWith('0.1');
      expect((svc as any).supportingSolLamports).toBe(BigInt(100_000_000));
    });

    it('should be 0 when set to "0"', async () => {
      const svc = await buildServiceWith('0');
      expect((svc as any).supportingSolLamports).toBe(0n);
    });

    it('should be 0 when set to invalid value', async () => {
      const svc = await buildServiceWith('not-a-number');
      expect((svc as any).supportingSolLamports).toBe(0n);
    });
  });
});
