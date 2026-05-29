import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MarketService } from './market.service';
import { MarketEntity } from './entity/market.entity';
import { TradeEntity } from './entity/trade.entity';
import { BookmarkEntity } from './entity/bookmark.entity';
import { UserEntity } from '../user/entity/user.entity';
import { UserPositionEntity } from '../user/entity/user-position.entity';
import { LpPositionEntity } from '../user/entity/lp-position.entity';

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
    category: 'crypto',
    subject: 'SOL',
    tags: null,
    icon: null,
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
    protocolFeeAccumulated: '0',
    lpFeeAccumulated: '0',
    lpSharesTotal: '0',
    updatedAt: new Date(),
    ...overrides,
  } as MarketEntity;
}

describe('MarketService', () => {
  let service: MarketService;
  let marketRepo: Record<string, jest.Mock>;
  let tradeRepo: Record<string, jest.Mock>;
  let bookmarkRepo: Record<string, jest.Mock>;
  let userRepo: Record<string, jest.Mock>;
  let positionRepo: Record<string, jest.Mock>;
  let lpRepo: Record<string, jest.Mock>;

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
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: '0' }),
      }),
    };

    const bookmarkInsertQb = {
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({}),
    };

    bookmarkRepo = {
      find: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(bookmarkInsertQb),
    };

    userRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((dto: any) => dto),
      save: jest.fn((entity: any) => Promise.resolve({ ...entity, id: entity.id ?? '1' })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      }),
    };

    positionRepo = {
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: '0' }),
      }),
    };

    lpRepo = {
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: '0' }),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketService,
        { provide: getRepositoryToken(MarketEntity), useValue: marketRepo },
        { provide: getRepositoryToken(TradeEntity), useValue: tradeRepo },
        { provide: getRepositoryToken(BookmarkEntity), useValue: bookmarkRepo },
        { provide: getRepositoryToken(UserEntity), useValue: userRepo },
        { provide: getRepositoryToken(UserPositionEntity), useValue: positionRepo },
        { provide: getRepositoryToken(LpPositionEntity), useValue: lpRepo },
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
        subject: 'ETH',
        tags: ['eth', 'defi'],
        icon: 'eth',
        outcomeLabels: ['A', 'B'],
        rangeMin: 100,
        rangeMax: 200,
      };

      await service.create(dto);

      expect(marketRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Desc',
          category: 'crypto',
          subject: 'ETH',
          tags: ['eth', 'defi'],
          icon: 'eth',
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
          category: 'crypto',
          subject: 'SOL',
          tags: null,
          icon: null,
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

    it('should filter by subject', async () => {
      await service.findAll({ subject: 'BTC' });
      expect(qb.andWhere).toHaveBeenCalledWith('m.subject = :subject', {
        subject: 'BTC',
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

    it('should filter by creator', async () => {
      await service.findAll({ creator: 'Creator11111111111111111111111111111111111111' });
      expect(qb.andWhere).toHaveBeenCalledWith('m.creator = :creator', {
        creator: 'Creator11111111111111111111111111111111111111',
      });
    });

    it('should not filter by creator when not provided', async () => {
      await service.findAll({});
      const creatorCalls = (qb.andWhere as jest.Mock).mock.calls.filter(
        ([sql]: [string]) => sql.includes('creator'),
      );
      expect(creatorCalls).toHaveLength(0);
    });

    it('should apply ILIKE search filter with ESCAPE clause', async () => {
      await service.findAll({ search: 'ETH' });
      expect(qb.andWhere).toHaveBeenCalledWith(
        "m.title ILIKE :search ESCAPE '\\'",
        { search: '%ETH%' },
      );
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

    it('should return stats when includeStats is true', async () => {
      const statsQb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ totalVolume: '5000', totalTraders: '10' }),
      };
      marketRepo.createQueryBuilder
        .mockReturnValueOnce(qb)
        .mockReturnValueOnce(statsQb);

      const result = await service.findAll({ includeStats: true, creator: 'C' });
      expect(result.stats).toEqual({ totalVolume: '5000', totalTraders: 10 });
      expect(statsQb.andWhere).toHaveBeenCalledWith('m.creator = :creator', { creator: 'C' });
    });

    it('should not return stats when includeStats is not set', async () => {
      const result = await service.findAll({});
      expect(result.stats).toBeUndefined();
      expect(marketRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
    });

    it('should return stats without creator filter when creator not provided', async () => {
      const statsQb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ totalVolume: '9999', totalTraders: '50' }),
      };
      marketRepo.createQueryBuilder
        .mockReturnValueOnce(qb)
        .mockReturnValueOnce(statsQb);

      const result = await service.findAll({ includeStats: true });
      expect(result.stats).toEqual({ totalVolume: '9999', totalTraders: 50 });
      expect(statsQb.andWhere).not.toHaveBeenCalled();
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

    it('should compute linear probabilities from reserves', async () => {
      // totalMinted = 1000, reserves = [400, 200]
      // x0 = 1000-400 = 600, x1 = 1000-200 = 800, sumX = 1400
      // p_i = x_i / sumX → p0 = 600/1400 ≈ 0.4286, p1 = 800/1400 ≈ 0.5714
      const market = createMockMarket({
        reserves: ['400', '200'],
        kSquared: '1000000',
        totalMinted: '1000',
      });
      marketRepo.findOne.mockResolvedValue(market);

      const result = await service.getPrices(1);
      expect(result.probabilities[0]).toBeCloseTo(0.4286, 4);
      expect(result.probabilities[1]).toBeCloseTo(0.5714, 4);
    });

    it('should throw when market not found', async () => {
      marketRepo.findOne.mockResolvedValue(null);
      await expect(service.getPrices(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getHistory', () => {
    it('should return paginated trade history with masked traders for unauthenticated caller', async () => {
      const trades = [{ id: '1', trader: 'Trader11111111111111111111111111111111111111' }] as any;
      tradeRepo.findAndCount.mockResolvedValue([trades, 1]);

      const result = await service.getHistory(1, 1, 50);
      expect(result.total).toBe(1);
      expect(result.data).toHaveLength(1);
      // Trader should be masked (no matching user → anon#...)
      expect(result.data[0].trader).toMatch(/^anon#/);
      expect(tradeRepo.findAndCount).toHaveBeenCalledWith({
        where: { marketId: '1' },
        order: { timestamp: 'DESC' },
        skip: 0,
        take: 50,
      });
    });

    it('should return full trader data for privileged caller', async () => {
      const trades = [{ id: '1', trader: 'Trader11111111111111111111111111111111111111' }] as any;
      tradeRepo.findAndCount.mockResolvedValue([trades, 1]);

      const result = await service.getHistory(1, 1, 50, 'Admin111', true);
      expect(result.data[0].trader).toBe('Trader11111111111111111111111111111111111111');
    });

    it('should respect page and limit params', async () => {
      tradeRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.getHistory(1, 3, 10);
      expect(tradeRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });
  });

  describe('getOracleData', () => {
    it('should return nulls for binary market (non-continuous)', async () => {
      const market = createMockMarket({ marketType: 0 });
      marketRepo.findOne.mockResolvedValue(market);

      const result = await service.getOracleData(1);
      expect(result).toEqual({
        distributionPeak: null,
        mostLikelyRange: null,
        confidence95: null,
      });
    });

    it('should return nulls for continuous market without range', async () => {
      const market = createMockMarket({
        marketType: 2,
        rangeMin: null,
        rangeMax: null,
      });
      marketRepo.findOne.mockResolvedValue(market);

      const result = await service.getOracleData(1);
      expect(result).toEqual({
        distributionPeak: null,
        mostLikelyRange: null,
        confidence95: null,
      });
    });

    it('should return values within market range for continuous market', async () => {
      const SCALE = 1_000_000_000;
      const market = createMockMarket({
        marketType: 2,
        numOutcomes: 10,
        rangeMin: String(60_000 * SCALE),
        rangeMax: String(160_000 * SCALE),
        // Reserves shaped so bin 4 (center-left) has highest probability
        reserves: ['90', '85', '80', '70', '60', '65', '75', '80', '85', '90'],
        totalMinted: '1000',
        kSquared: '1000000',
      });
      marketRepo.findOne.mockResolvedValue(market);

      const result = await service.getOracleData(1);

      // Peak should be within range
      expect(result.distributionPeak).toBeGreaterThanOrEqual(60_000);
      expect(result.distributionPeak).toBeLessThanOrEqual(160_000);

      // Most likely range should be within market range
      expect(result.mostLikelyRange![0]).toBeGreaterThanOrEqual(60_000);
      expect(result.mostLikelyRange![1]).toBeLessThanOrEqual(160_000);
      expect(result.mostLikelyRange![0]).toBeLessThan(result.mostLikelyRange![1]);

      // 95% confidence should be within range and wider than most likely
      expect(result.confidence95![0]).toBeGreaterThanOrEqual(60_000);
      expect(result.confidence95![1]).toBeLessThanOrEqual(160_000);
      expect(result.confidence95![0]).toBeLessThanOrEqual(result.mostLikelyRange![0]);
      expect(result.confidence95![1]).toBeGreaterThanOrEqual(result.mostLikelyRange![1]);
    });

    it('should use center bin when totalMinted is 0 (uniform)', async () => {
      const SCALE = 1_000_000_000;
      const market = createMockMarket({
        marketType: 2,
        numOutcomes: 10,
        rangeMin: String(0),
        rangeMax: String(100 * SCALE),
        reserves: Array(10).fill('0'),
        totalMinted: '0',
        kSquared: '0',
      });
      marketRepo.findOne.mockResolvedValue(market);

      const result = await service.getOracleData(1);

      // Center bin = 5, binWidth = 10, peak = 0 + 10 * (5 + 0.5) = 55
      expect(result.distributionPeak).toBe(55);
      expect(result.mostLikelyRange).not.toBeNull();
      expect(result.confidence95).not.toBeNull();
    });

    it('should throw NotFoundException for missing market', async () => {
      marketRepo.findOne.mockResolvedValue(null);
      await expect(service.getOracleData(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateEditableMetadata', () => {
    it('should allow creator to update category, subject, icon, and tags', async () => {
      const owner = 'Creator11111111111111111111111111111111111111';
      marketRepo.findOne.mockResolvedValue(
        createMockMarket({
          creator: owner,
          category: 'crypto',
          subject: 'SOL',
          icon: null,
          tags: ['old'],
        }),
      );

      const result = await service.updateEditableMetadata(
        1,
        owner,
        false,
        {
          category: ' macro ',
          subject: ' BTC ',
          icon: ' https://cdn/icon.png ',
          tags: [' alpha ', '', 'beta '],
        },
      );

      expect(marketRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'macro',
          subject: 'BTC',
          icon: 'https://cdn/icon.png',
          tags: ['alpha', 'beta'],
        }),
      );
      expect(result.category).toBe('macro');
      expect(result.subject).toBe('BTC');
      expect(result.icon).toBe('https://cdn/icon.png');
      expect(result.tags).toEqual(['alpha', 'beta']);
    });

    it('should allow admin/superadmin to update a market they did not create', async () => {
      marketRepo.findOne.mockResolvedValue(
        createMockMarket({
          creator: 'DifferentCreator111111111111111111111111111111',
          icon: 'old-icon',
        }),
      );

      const result = await service.updateEditableMetadata(
        1,
        'Admin1111111111111111111111111111111111111111',
        true,
        { icon: null },
      );

      expect(marketRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ icon: null }),
      );
      expect(result.icon).toBeNull();
    });

    it('should reject non-owner creator when not admin/superadmin', async () => {
      marketRepo.findOne.mockResolvedValue(
        createMockMarket({
          creator: 'Owner111111111111111111111111111111111111111',
        }),
      );

      await expect(
        service.updateEditableMetadata(
          1,
          'OtherCreator11111111111111111111111111111111111',
          false,
          { category: 'crypto' },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should reject empty patch payload', async () => {
      marketRepo.findOne.mockResolvedValue(createMockMarket());

      await expect(
        service.updateEditableMetadata(
          1,
          'Creator11111111111111111111111111111111111111',
          true,
          {},
        ),
      ).rejects.toThrow(BadRequestException);
      expect(marketRepo.save).not.toHaveBeenCalled();
    });

    it('should clear icon and tags when empty values are provided', async () => {
      marketRepo.findOne.mockResolvedValue(
        createMockMarket({
          icon: 'old-icon',
          tags: ['alpha'],
        }),
      );

      const result = await service.updateEditableMetadata(
        1,
        'Creator11111111111111111111111111111111111111',
        true,
        {
          icon: '   ',
          tags: [],
        },
      );

      expect(marketRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          icon: null,
          tags: null,
        }),
      );
      expect(result.icon).toBeNull();
      expect(result.tags).toBeNull();
    });

    it('should reject empty category/subject strings', async () => {
      marketRepo.findOne.mockResolvedValue(createMockMarket());

      await expect(
        service.updateEditableMetadata(
          1,
          'Creator11111111111111111111111111111111111111',
          true,
          { category: '   ' },
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.updateEditableMetadata(
          1,
          'Creator11111111111111111111111111111111111111',
          true,
          { subject: '   ' },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('bookmarks', () => {
    it('should return bookmarked markets ordered by newest bookmark first', async () => {
      const m1 = createMockMarket({ id: '1', title: 'One' });
      const m2 = createMockMarket({ id: '2', title: 'Two' });
      bookmarkRepo.find.mockResolvedValue([
        { market: m2 },
        { market: m1 },
      ]);

      const result = await service.getBookmarkedMarkets(
        'Wallet11111111111111111111111111111111111111',
      );

      expect(bookmarkRepo.find).toHaveBeenCalledWith({
        where: { userAddress: 'Wallet11111111111111111111111111111111111111' },
        relations: ['market'],
        order: { createdAt: 'DESC' },
      });
      expect(result).toEqual([m2, m1]);
    });

    it('should return bookmark state as true when bookmark exists', async () => {
      marketRepo.findOne.mockResolvedValue(createMockMarket());
      bookmarkRepo.count.mockResolvedValue(1);

      const result = await service.getBookmarkState(
        1,
        'Wallet11111111111111111111111111111111111111',
      );

      expect(bookmarkRepo.count).toHaveBeenCalledWith({
        where: {
          marketId: '1',
          userAddress: 'Wallet11111111111111111111111111111111111111',
        },
      });
      expect(result).toEqual({ bookmarked: true });
    });

    it('should add bookmark idempotently', async () => {
      marketRepo.findOne.mockResolvedValue(createMockMarket());

      const result = await service.addBookmark(
        1,
        'Wallet11111111111111111111111111111111111111',
      );

      expect(bookmarkRepo.createQueryBuilder).toHaveBeenCalled();
      const qb = bookmarkRepo.createQueryBuilder.mock.results[0].value;
      expect(qb.insert).toHaveBeenCalled();
      expect(qb.values).toHaveBeenCalledWith({
        marketId: '1',
        userAddress: 'Wallet11111111111111111111111111111111111111',
      });
      expect(qb.orIgnore).toHaveBeenCalled();
      expect(qb.execute).toHaveBeenCalled();
      expect(result).toEqual({ bookmarked: true });
    });

    it('should remove bookmark', async () => {
      marketRepo.findOne.mockResolvedValue(createMockMarket());
      bookmarkRepo.delete.mockResolvedValue({ affected: 1 });

      const result = await service.removeBookmark(
        1,
        'Wallet11111111111111111111111111111111111111',
      );

      expect(bookmarkRepo.delete).toHaveBeenCalledWith({
        marketId: '1',
        userAddress: 'Wallet11111111111111111111111111111111111111',
      });
      expect(result).toEqual({ bookmarked: false });
    });
  });

  describe('getMarketProperties', () => {
    it('should return market data and stats for the creator', async () => {
      const owner = 'Creator11111111111111111111111111111111111111';
      const market = createMockMarket({
        creator: owner,
        protocolFeeAccumulated: '100',
        lpFeeAccumulated: '50',
        lpSharesTotal: '999',
      });
      marketRepo.findOne.mockResolvedValue(market);
      tradeRepo.count.mockResolvedValue(5);
      positionRepo.count.mockResolvedValue(3);
      lpRepo.count.mockResolvedValue(2);

      const result = await service.getMarketProperties(1, owner, false);

      expect(result.market.id).toBe('1');
      expect(result.market.creator).toBe(owner);
      expect(result.stats.totalTrades).toBe(5);
      expect(result.stats.totalPositions).toBe(3);
      expect(result.stats.totalLps).toBe(2);
      expect(result.stats.totalDeposited).toBe('0');
      expect(result.stats.protocolFeeAccumulated).toBe('100');
      expect(result.stats.lpFeeAccumulated).toBe('50');
      expect(result.stats.lpSharesTotal).toBe('999');
    });

    it('should allow admin to view any market properties', async () => {
      const market = createMockMarket({
        creator: 'OtherCreator111111111111111111111111111111111',
      });
      marketRepo.findOne.mockResolvedValue(market);
      tradeRepo.count.mockResolvedValue(0);
      positionRepo.count.mockResolvedValue(0);
      lpRepo.count.mockResolvedValue(0);

      const result = await service.getMarketProperties(
        1,
        'Admin1111111111111111111111111111111111111111',
        true,
      );
      expect(result.market.id).toBe('1');
    });

    it('should reject non-creator non-admin', async () => {
      const market = createMockMarket({
        creator: 'Owner111111111111111111111111111111111111111',
      });
      marketRepo.findOne.mockResolvedValue(market);

      await expect(
        service.getMarketProperties(
          1,
          'Random1111111111111111111111111111111111111111',
          false,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException for missing market', async () => {
      marketRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getMarketProperties(999, 'Anyone', false),
      ).rejects.toThrow(NotFoundException);
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

});
