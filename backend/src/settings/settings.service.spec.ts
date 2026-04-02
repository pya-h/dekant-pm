import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SettingsService } from './settings.service';
import { SettingEntity } from './setting.entity';

describe('SettingsService', () => {
  let service: SettingsService;
  let repo: Record<string, jest.Mock>;
  let qrManager: Record<string, jest.Mock>;
  let queryRunner: Record<string, jest.Mock>;

  beforeEach(async () => {
    repo = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) =>
        Promise.resolve({ ...entity, id: entity.id ?? 1, updatedAt: new Date() }),
      ),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    qrManager = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager: qrManager as any,
    };
    const dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: getRepositoryToken(SettingEntity), useValue: repo },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<SettingsService>(SettingsService);
  });

  describe('getActive', () => {
    it('should return active settings row when it exists', async () => {
      repo.findOne.mockResolvedValueOnce({
        id: 1,
        name: 'default',
        isActive: true,
        feeCollectInterval: '12h',
        deadlineCheckInterval: '2m',
      });
      const result = await service.getActive();
      expect(result.feeCollectInterval).toBe('12h');
      expect(result.deadlineCheckInterval).toBe('2m');
      expect(repo.findOne).toHaveBeenCalledWith({ where: { isActive: true } });
    });

    it('should return defaults when no active row exists', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      const result = await service.getActive();
      expect(result.feeCollectInterval).toBe('none');
      expect(result.deadlineCheckInterval).toBe('1m');
      expect(result.isActive).toBe(true);
    });
  });

  describe('update', () => {
    it('should update feeCollectInterval on active row', async () => {
      repo.findOne.mockResolvedValueOnce({
        id: 1,
        name: 'default',
        isActive: true,
        feeCollectInterval: 'none',
        deadlineCheckInterval: '1m',
      });
      const result = await service.update({ feeCollectInterval: '6h' });
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ feeCollectInterval: '6h' }),
      );
      expect(result.feeCollectInterval).toBe('6h');
    });

    it('should update deadlineCheckInterval on active row', async () => {
      repo.findOne.mockResolvedValueOnce({
        id: 1,
        name: 'default',
        isActive: true,
        feeCollectInterval: 'none',
        deadlineCheckInterval: '1m',
      });
      const result = await service.update({ deadlineCheckInterval: '5m' });
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ deadlineCheckInterval: '5m' }),
      );
      expect(result.deadlineCheckInterval).toBe('5m');
    });

    it('should handle no-op update', async () => {
      repo.findOne.mockResolvedValueOnce({
        id: 1,
        name: 'default',
        isActive: true,
        feeCollectInterval: '12h',
        deadlineCheckInterval: '2m',
      });
      const result = await service.update({});
      expect(result.feeCollectInterval).toBe('12h');
      expect(result.deadlineCheckInterval).toBe('2m');
    });
  });

  describe('create', () => {
    it('should create an inactive settings row', async () => {
      const result = await service.create({ name: 'staging', feeCollectInterval: '24h' });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'staging', isActive: false, feeCollectInterval: '24h' }),
      );
      expect(repo.save).toHaveBeenCalled();
      expect(result.isActive).toBe(false);
    });
  });

  describe('activate', () => {
    it('should deactivate all then activate target in a transaction', async () => {
      repo.findOne.mockResolvedValueOnce({ id: 2, isActive: true, name: 'staging' });
      const result = await service.activate(2);
      expect(queryRunner.connect).toHaveBeenCalled();
      expect(queryRunner.startTransaction).toHaveBeenCalled();
      expect(qrManager.update).toHaveBeenCalledWith(SettingEntity, {}, { isActive: false });
      expect(qrManager.update).toHaveBeenCalledWith(SettingEntity, 2, { isActive: true });
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
    });
  });

  describe('getById', () => {
    it('should return a row when it exists', async () => {
      repo.findOne.mockResolvedValueOnce({ id: 2, name: 'staging', isActive: false });
      const result = await service.getById(2);
      expect(result).toEqual({ id: 2, name: 'staging', isActive: false });
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 2 } });
    });

    it('should return null when row does not exist', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      const result = await service.getById(999);
      expect(result).toBeNull();
    });
  });

  describe('listAll', () => {
    it('should return all rows ordered by id ASC', async () => {
      const rows = [
        { id: 1, name: 'default', isActive: true },
        { id: 2, name: 'staging', isActive: false },
      ];
      repo.find.mockResolvedValueOnce(rows);
      const result = await service.listAll();
      expect(result).toEqual(rows);
      expect(repo.find).toHaveBeenCalledWith({ order: { id: 'ASC' } });
    });

    it('should return empty array when no rows exist', async () => {
      repo.find.mockResolvedValueOnce([]);
      const result = await service.listAll();
      expect(result).toEqual([]);
    });
  });

  describe('remove', () => {
    it('should delete inactive row', async () => {
      await service.remove(3);
      expect(repo.delete).toHaveBeenCalledWith({ id: 3, isActive: false });
    });
  });

  describe('getFeeCollectionInterval', () => {
    it('should return "none" when no active row exists', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      expect(await service.getFeeCollectionInterval()).toBe('none');
    });

    it('should return stored interval when valid', async () => {
      repo.findOne.mockResolvedValueOnce({ id: 1, isActive: true, feeCollectInterval: '12h', deadlineCheckInterval: '1m' });
      expect(await service.getFeeCollectionInterval()).toBe('12h');
    });

    it('should return "none" for invalid stored value', async () => {
      repo.findOne.mockResolvedValueOnce({ id: 1, isActive: true, feeCollectInterval: 'invalid', deadlineCheckInterval: '1m' });
      expect(await service.getFeeCollectionInterval()).toBe('none');
    });

    it.each(['6h', '12h', '24h', '48h', 'none'] as const)(
      'should accept valid interval: %s',
      async (interval) => {
        repo.findOne.mockResolvedValueOnce({ id: 1, isActive: true, feeCollectInterval: interval, deadlineCheckInterval: '1m' });
        expect(await service.getFeeCollectionInterval()).toBe(interval);
      },
    );
  });

  describe('getDeadlineCheckInterval', () => {
    it('should return "1m" when no active row exists', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      expect(await service.getDeadlineCheckInterval()).toBe('1m');
    });

    it('should return stored interval when valid', async () => {
      repo.findOne.mockResolvedValueOnce({ id: 1, isActive: true, feeCollectInterval: 'none', deadlineCheckInterval: '5m' });
      expect(await service.getDeadlineCheckInterval()).toBe('5m');
    });

    it('should return "1m" for invalid stored value', async () => {
      repo.findOne.mockResolvedValueOnce({ id: 1, isActive: true, feeCollectInterval: 'none', deadlineCheckInterval: 'invalid' });
      expect(await service.getDeadlineCheckInterval()).toBe('1m');
    });

    it.each(['30s', '1m', '2m', '5m', '10m'] as const)(
      'should accept valid interval: %s',
      async (interval) => {
        repo.findOne.mockResolvedValueOnce({ id: 1, isActive: true, feeCollectInterval: 'none', deadlineCheckInterval: interval });
        expect(await service.getDeadlineCheckInterval()).toBe(interval);
      },
    );
  });

  describe('onModuleInit', () => {
    it('should create default row if no active row exists', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      await service.onModuleInit();
      expect(repo.save).toHaveBeenCalled();
    });

    it('should not overwrite existing active row', async () => {
      repo.findOne.mockResolvedValueOnce({ id: 1, isActive: true, feeCollectInterval: '6h', deadlineCheckInterval: '2m' });
      await service.onModuleInit();
      expect(repo.save).not.toHaveBeenCalled();
    });
  });
});
