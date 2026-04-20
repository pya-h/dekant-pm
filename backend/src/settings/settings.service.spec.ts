import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SettingsService } from './settings.service';
import { SettingEntity } from './setting.entity';

describe('SettingsService', () => {
  let service: SettingsService;
  let repo: Record<string, jest.Mock>;

  beforeEach(async () => {
    repo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) =>
        Promise.resolve({ ...entity, updatedAt: new Date() }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: getRepositoryToken(SettingEntity), useValue: repo },
      ],
    }).compile();

    service = module.get<SettingsService>(SettingsService);
  });

  describe('get', () => {
    it('should return settings row when it exists', async () => {
      repo.findOne.mockResolvedValueOnce({ id: 1, feeCollectInterval: '12h' });
      const result = await service.get();
      expect(result.feeCollectInterval).toBe('12h');
    });

    it('should return defaults when row does not exist', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      const result = await service.get();
      expect(result.feeCollectInterval).toBe('none');
    });
  });

  describe('update', () => {
    it('should update feeCollectInterval', async () => {
      repo.findOne.mockResolvedValueOnce({ id: 1, feeCollectInterval: 'none' });
      const result = await service.update({ feeCollectInterval: '6h' });
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ feeCollectInterval: '6h' }),
      );
      expect(result.feeCollectInterval).toBe('6h');
    });

    it('should handle no-op update', async () => {
      repo.findOne.mockResolvedValueOnce({ id: 1, feeCollectInterval: '12h' });
      const result = await service.update({});
      expect(result.feeCollectInterval).toBe('12h');
    });
  });

  describe('getFeeCollectionInterval', () => {
    it('should return "none" when row does not exist', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      expect(await service.getFeeCollectionInterval()).toBe('none');
    });

    it('should return stored interval when valid', async () => {
      repo.findOne.mockResolvedValueOnce({ id: 1, feeCollectInterval: '12h' });
      expect(await service.getFeeCollectionInterval()).toBe('12h');
    });

    it('should return "none" for invalid stored value', async () => {
      repo.findOne.mockResolvedValueOnce({ id: 1, feeCollectInterval: 'invalid' });
      expect(await service.getFeeCollectionInterval()).toBe('none');
    });

    it.each(['6h', '12h', '24h', '48h', 'none'] as const)(
      'should accept valid interval: %s',
      async (interval) => {
        repo.findOne.mockResolvedValueOnce({ id: 1, feeCollectInterval: interval });
        expect(await service.getFeeCollectionInterval()).toBe(interval);
      },
    );
  });

  describe('onModuleInit', () => {
    it('should create settings row if not exists', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      await service.onModuleInit();
      expect(repo.save).toHaveBeenCalled();
    });

    it('should not overwrite existing row', async () => {
      repo.findOne.mockResolvedValueOnce({ id: 1, feeCollectInterval: '6h' });
      await service.onModuleInit();
      expect(repo.save).not.toHaveBeenCalled();
    });
  });
});
