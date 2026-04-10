import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { MarketService } from './market.service';
import { MarketEntity } from './entity/market.entity';
import { TradeEntity } from './entity/trade.entity';

function createMockMarket(overrides: Partial<MarketEntity> = {}): MarketEntity {
  return {
    id: '1',
    pubkey: 'MarketPubkey111111111111111111111111111111111',
    marketType: 0,
    state: 0,
    creator: 'Creator11111111111111111111111111111111111111',
    oracle: 'Oracle111111111111111111111111111111111111111',
    collateralMint: 'Mint11111111111111111111111111111111111111111',
    deadline: new Date('2025-12-31'),
    createdAt: new Date('2025-01-01'),
    resolvedAt: null,
    numOutcomes: 2,
    title: 'Test Market',
    description: null,
    category: null,
    tags: null,
    imageUrl: null,
    outcomeLabels: ['Yes', 'No'],
    reserves: ['500000000', '500000000'],
    kSquared: '500000000000000000',
    totalMinted: '1000000000',
    resolvedOutcome: null,
    resolvedValue: null,
    rangeMin: null,
    rangeMax: null,
    totalVolume: '0',
    totalTraders: 0,
    lastTradeAt: null,
    updatedAt: new Date(),
    ...overrides,
  } as MarketEntity;
}

describe('MarketService', () => {
  let service: MarketService;
  let marketRepo: Record<string, jest.Mock>;
  let tradeRepo: Record<string, jest.Mock>;

  beforeEach(async () => {
    marketRepo = {
      create: jest.fn((dto) => dto),
      save: jest.fn((entity) => Promise.resolve({ ...entity, id: entity.id ?? '1' })),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(),
    };

    tradeRepo = {
      findAndCount: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketService,
        { provide: getRepositoryToken(MarketEntity), useValue: marketRepo },
        { provide: getRepositoryToken(TradeEntity), useValue: tradeRepo },
      ],
    }).compile();

    service = module.get<MarketService>(MarketService);
  });

  describe('create', () => {
    it('should create a market with initial reserves of zeroes', async () => {
      const dto = {
        title: 'Will ETH hit $10k?',
        marketId: 42,
        pubkey: 'Pubkey111111111111111111111111111111111111111',
        marketType: 0,
        numOutcomes: 3,
        creator: 'Creator11111111111111111111111111111111111111',
        oracle: 'Oracle111111111111111111111111111111111111111',
        collateralMint: 'Mint11111111111111111111111111111111111111111',
        deadline: '2025-12-31T00:00:00Z',
      };

      await service.create(dto);

      expect(marketRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '42',
          reserves: ['0', '0', '0'],
          kSquared: '0',
          totalMinted: '0',
        }),
      );
      expect(marketRepo.save).toHaveBeenCalled();
    });

    it('should pass optional metadata fields', async () => {
      const dto = {
        title: 'Test',
        marketId: 1,
        pubkey: 'Pk11111111111111111111111111111111111111111111',
        marketType: 2,
        numOutcomes: 10,
        creator: 'C',
        oracle: 'O',
        collateralMint: 'M',
        deadline: '2025-12-31T00:00:00Z',
        description: 'Desc',
        category: 'crypto',
        tags: ['eth', 'defi'],
        imageUrl: 'https://example.com/img.png',
        outcomeLabels: ['A', 'B'],
        rangeMin: 100,
        rangeMax: 200,
      };

      await service.create(dto);

      expect(marketRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Desc',
          category: 'crypto',
          tags: ['eth', 'defi'],
          imageUrl: 'https://example.com/img.png',
          outcomeLabels: ['A', 'B'],
          rangeMin: '100',
          rangeMax: '200',
        }),
      );
    });

    it('should set nullable fields to null when not provided', async () => {
      const dto = {
        title: 'Minimal',
        marketId: 1,
        pubkey: 'Pk',
        marketType: 0,
        numOutcomes: 2,
        creator: 'C',
        oracle: 'O',
        collateralMint: 'M',
        deadline: '2025-12-31T00:00:00Z',
      };

      await service.create(dto);

      expect(marketRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: null,
          category: null,
          tags: null,
          imageUrl: null,
          outcomeLabels: null,
          rangeMin: null,
          rangeMax: null,
        }),
      );
    });
  });

  describe('findById', () => {
    it('should return the market when found', async () => {
      const market = createMockMarket();
      marketRepo.findOne.mockResolvedValue(market);

      const result = await service.findById(1);
      expect(result).toBe(market);
      expect(marketRepo.findOne).toHaveBeenCalledWith({ where: { id: '1' } });
    });

    it('should throw NotFoundException when market does not exist', async () => {
      marketRepo.findOne.mockResolvedValue(null);
      await expect(service.findById(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    let qb: Record<string, jest.Mock>;

    beforeEach(() => {
      qb = {
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      marketRepo.createQueryBuilder.mockReturnValue(qb);
    });

    it('should apply default pagination (page=1, limit=20)', async () => {
      await service.findAll({});
      expect(qb.skip).toHaveBeenCalledWith(0);
      expect(qb.take).toHaveBeenCalledWith(20);
    });

    it('should apply custom pagination', async () => {
      await service.findAll({ page: 3, limit: 10 });
      expect(qb.skip).toHaveBeenCalledWith(20);
      expect(qb.take).toHaveBeenCalledWith(10);
    });

    it('should filter by category', async () => {
      await service.findAll({ category: 'crypto' });
      expect(qb.andWhere).toHaveBeenCalledWith('m.category = :category', {
        category: 'crypto',
      });
    });

    it('should filter by marketType', async () => {
      await service.findAll({ marketType: 1 });
      expect(qb.andWhere).toHaveBeenCalledWith('m.market_type = :marketType', {
        marketType: 1,
      });
    });

    it('should filter by state', async () => {
      await service.findAll({ state: 0 });
      expect(qb.andWhere).toHaveBeenCalledWith('m.state = :state', {
        state: 0,
      });
    });

    it('should apply ILIKE search filter', async () => {
      await service.findAll({ search: 'ETH' });
      expect(qb.andWhere).toHaveBeenCalledWith('m.title ILIKE :search', {
        search: '%ETH%',
      });
    });

    it('should sort by deadline when requested', async () => {
      await service.findAll({ sortBy: 'deadline' });
      expect(qb.orderBy).toHaveBeenCalledWith('m.deadline', 'ASC');
    });

    it('should sort by volume when requested', async () => {
      await service.findAll({ sortBy: 'volume' });
      expect(qb.orderBy).toHaveBeenCalledWith('m.total_volume', 'DESC');
    });

    it('should default sort to created_at DESC', async () => {
      await service.findAll({});
      expect(qb.orderBy).toHaveBeenCalledWith('m.created_at', 'DESC');
    });

    it('should return data and total count', async () => {
      const markets = [createMockMarket()];
      qb.getManyAndCount.mockResolvedValue([markets, 1]);

      const result = await service.findAll({});
      expect(result).toEqual({ data: markets, total: 1 });
    });
  });

  describe('getPrices', () => {
    it('should return uniform probabilities when kSquared is 0', async () => {
      const market = createMockMarket({
        reserves: ['0', '0', '0'],
        kSquared: '0',
        totalMinted: '0',
      });
      marketRepo.findOne.mockResolvedValue(market);

      const result = await service.getPrices(1);
      const expected = 1 / 3;
      expect(result.probabilities).toHaveLength(3);
      result.probabilities.forEach((p) => expect(p).toBeCloseTo(expected));
    });

    it('should compute L2 norm probabilities from reserves', async () => {
      // totalMinted = 1000, reserves = [700, 800]
      // x0 = 1000-700 = 300, x1 = 1000-800 = 200
      // kSq = 300^2 + 200^2 = 90000 + 40000 = 130000
      const market = createMockMarket({
        reserves: ['700', '800'],
        kSquared: '130000',
        totalMinted: '1000',
      });
      marketRepo.findOne.mockResolvedValue(market);

      const result = await service.getPrices(1);
      expect(result.probabilities[0]).toBeCloseTo(90000 / 130000);
      expect(result.probabilities[1]).toBeCloseTo(40000 / 130000);
    });

    it('should throw when market not found', async () => {
      marketRepo.findOne.mockResolvedValue(null);
      await expect(service.getPrices(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getHistory', () => {
    it('should return paginated trade history', async () => {
      const trades = [{ id: '1' }] as any;
      tradeRepo.findAndCount.mockResolvedValue([trades, 1]);

      const result = await service.getHistory(1, 1, 50);
      expect(result).toEqual({ data: trades, total: 1 });
      expect(tradeRepo.findAndCount).toHaveBeenCalledWith({
        where: { marketId: '1' },
        order: { timestamp: 'DESC' },
        skip: 0,
        take: 50,
      });
    });

    it('should respect page and limit params', async () => {
      tradeRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.getHistory(1, 3, 10);
      expect(tradeRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });
  });

  describe('updateCachedState', () => {
    it('should delegate to repo.update with string id', async () => {
      await service.updateCachedState(1, { state: 3, resolvedOutcome: 0 });
      expect(marketRepo.update).toHaveBeenCalledWith('1', {
        state: 3,
        resolvedOutcome: 0,
      });
    });
  });

  describe('incrementVolume', () => {
    it('should build a raw update query for volume', async () => {
      const qb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };
      marketRepo.createQueryBuilder.mockReturnValue(qb);

      await service.incrementVolume(1, '5000', 'TraderAddress');

      expect(qb.update).toHaveBeenCalledWith(MarketEntity);
      expect(qb.where).toHaveBeenCalledWith('id = :id', { id: '1' });
      expect(qb.execute).toHaveBeenCalled();
    });
  });
});
