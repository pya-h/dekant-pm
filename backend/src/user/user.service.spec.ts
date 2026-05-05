import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import { UserService } from './user.service';
import { UserEntity } from './entity/user.entity';
import { UserPositionEntity } from './entity/user-position.entity';
import { LpPositionEntity } from './entity/lp-position.entity';
import { UserRoleEntity } from './entity/user-role.entity';
import { TradeEntity } from '../market/entity/trade.entity';
import { MarketEntity } from '../market/entity/market.entity';

describe('UserService', () => {
  let service: UserService;
  let userRepo: Record<string, jest.Mock>;
  let positionRepo: Record<string, jest.Mock>;
  let lpPositionRepo: Record<string, jest.Mock>;
  let roleRepo: Record<string, jest.Mock>;
  let tradeRepo: Record<string, jest.Mock>;
  let marketRepo: Record<string, jest.Mock>;

  const WALLET = 'WaLLet111111111111111111111111111111111111111';

  beforeEach(async () => {
    userRepo = {
      findOne: jest.fn(),
      create: jest.fn((data) => ({ ...data, id: '1' })),
      save: jest.fn((entity) => Promise.resolve({ ...entity, id: entity.id ?? '1' })),
    };
    positionRepo = { find: jest.fn(), findOne: jest.fn() };
    lpPositionRepo = { find: jest.fn() };
    roleRepo = { find: jest.fn() };
    tradeRepo = { findAndCount: jest.fn() };
    marketRepo = { createQueryBuilder: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getRepositoryToken(UserEntity), useValue: userRepo },
        { provide: getRepositoryToken(UserPositionEntity), useValue: positionRepo },
        { provide: getRepositoryToken(LpPositionEntity), useValue: lpPositionRepo },
        { provide: getRepositoryToken(UserRoleEntity), useValue: roleRepo },
        { provide: getRepositoryToken(TradeEntity), useValue: tradeRepo },
        { provide: getRepositoryToken(MarketEntity), useValue: marketRepo },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => key === 'MAX_FAUCETS_PER_DAY' ? '5' : undefined) },
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  // ── Profile ─────────────────────────────────────────────────────

  describe('findOrCreateUser', () => {
    it('should return existing user if found', async () => {
      const existing = { id: '1', walletAddress: WALLET, username: 'test_user' };
      userRepo.findOne.mockResolvedValue(existing);

      const result = await service.findOrCreateUser(WALLET);

      expect(result).toBe(existing);
      expect(userRepo.save).not.toHaveBeenCalled();
    });

    it('should create new user with random username if not found', async () => {
      userRepo.findOne.mockResolvedValue(null);

      const result = await service.findOrCreateUser(WALLET);

      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          walletAddress: WALLET,
          faucetsPerDay: 5,
        }),
      );
      expect(result.username).toMatch(/^user_[a-f0-9]{8}$/);
      expect(userRepo.save).toHaveBeenCalled();
    });
  });

  describe('getProfile', () => {
    it('should return user profile or null', async () => {
      const user = { id: '1', walletAddress: WALLET, username: 'abc' };
      userRepo.findOne.mockResolvedValue(user);

      const result = await service.getProfile(WALLET);
      expect(result).toBe(user);
    });

    it('should return null for non-existing user', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const result = await service.getProfile(WALLET);
      expect(result).toBeNull();
    });
  });

  describe('updateProfile', () => {
    it('should update username', async () => {
      const user = { id: '1', walletAddress: WALLET, username: 'old', email: null, avatar: null };
      userRepo.findOne
        .mockResolvedValueOnce(user) // findOrCreateUser
        .mockResolvedValueOnce(null); // check username taken

      const result = await service.updateProfile(WALLET, { username: 'new_name' });

      expect(result.username).toBe('new_name');
      expect(userRepo.save).toHaveBeenCalled();
    });

    it('should throw ConflictException if username is taken', async () => {
      const user = { id: '1', walletAddress: WALLET, username: 'old', email: null, avatar: null };
      const other = { id: '2', walletAddress: 'OTHER', username: 'taken' };
      userRepo.findOne
        .mockResolvedValueOnce(user) // findOrCreateUser
        .mockResolvedValueOnce(other); // username check

      await expect(
        service.updateProfile(WALLET, { username: 'taken' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should update email', async () => {
      const user = { id: '1', walletAddress: WALLET, username: 'u', email: null, avatar: null };
      userRepo.findOne
        .mockResolvedValueOnce(user)
        .mockResolvedValueOnce(null); // email check

      const result = await service.updateProfile(WALLET, { email: 'a@b.com' });

      expect(result.email).toBe('a@b.com');
    });

    it('should throw ConflictException if email is taken', async () => {
      const user = { id: '1', walletAddress: WALLET, username: 'u', email: null, avatar: null };
      const other = { id: '2', walletAddress: 'OTHER', email: 'taken@b.com' };
      userRepo.findOne
        .mockResolvedValueOnce(user)
        .mockResolvedValueOnce(other); // email check

      await expect(
        service.updateProfile(WALLET, { email: 'taken@b.com' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should clear email when set to null', async () => {
      const user = { id: '1', walletAddress: WALLET, username: 'u', email: 'old@b.com', avatar: null };
      userRepo.findOne.mockResolvedValueOnce(user);

      const result = await service.updateProfile(WALLET, { email: null });

      expect(result.email).toBeNull();
    });

    it('should update avatar', async () => {
      const user = { id: '1', walletAddress: WALLET, username: 'u', email: null, avatar: null };
      userRepo.findOne.mockResolvedValueOnce(user);

      const result = await service.updateProfile(WALLET, { avatar: 'https://img.com/a.png' });

      expect(result.avatar).toBe('https://img.com/a.png');
    });
  });

  // ── Existing tests ────────────────────────────────────────────

  describe('getPositions', () => {
    it('should query positions by wallet address with market relation', async () => {
      const positions = [{ id: '1', userAddress: WALLET }];
      positionRepo.find.mockResolvedValue(positions);

      const result = await service.getPositions(WALLET);

      expect(result).toBe(positions);
      expect(positionRepo.find).toHaveBeenCalledWith({
        where: { userAddress: WALLET },
        relations: ['market'],
        order: { updatedAt: 'DESC' },
      });
    });

    it('should return empty array when user has no positions', async () => {
      positionRepo.find.mockResolvedValue([]);
      const result = await service.getPositions('NoPositionsWallet');
      expect(result).toEqual([]);
    });
  });

  describe('getTradeHistory', () => {
    it('should return paginated trade history with market relation', async () => {
      const trades = [{ id: '1', trader: WALLET }];
      tradeRepo.findAndCount.mockResolvedValue([trades, 1]);

      const result = await service.getTradeHistory(WALLET, 1, 50);

      expect(result).toEqual({ data: trades, total: 1 });
      expect(tradeRepo.findAndCount).toHaveBeenCalledWith({
        where: { trader: WALLET },
        relations: ['market'],
        order: { timestamp: 'DESC' },
        skip: 0,
        take: 50,
      });
    });

    it('should apply correct offset for page > 1', async () => {
      tradeRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.getTradeHistory(WALLET, 3, 10);

      expect(tradeRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('should use default page=1 and limit=50', async () => {
      tradeRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.getTradeHistory(WALLET);

      expect(tradeRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 50 }),
      );
    });
  });

  describe('getLpPositions', () => {
    it('should query LP positions by wallet address', async () => {
      const lps = [{ id: '1', userAddress: WALLET, shares: '1000' }];
      lpPositionRepo.find.mockResolvedValue(lps);

      const result = await service.getLpPositions(WALLET);

      expect(result).toBe(lps);
      expect(lpPositionRepo.find).toHaveBeenCalledWith({
        where: { userAddress: WALLET },
        relations: ['market'],
      });
    });
  });

  describe('getRoles', () => {
    it('should return all roles ordered by assignedAt DESC', async () => {
      const roles = [
        { id: '1', userAddress: WALLET, role: 1 },
        { id: '2', userAddress: 'Other', role: 2 },
      ];
      roleRepo.find.mockResolvedValue(roles);

      const result = await service.getRoles();

      expect(result).toBe(roles);
      expect(roleRepo.find).toHaveBeenCalledWith({
        order: { assignedAt: 'DESC' },
      });
    });
  });

  describe('getStaleMarkets', () => {
    let qb: Record<string, jest.Mock>;

    beforeEach(() => {
      qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      marketRepo.createQueryBuilder.mockReturnValue(qb);
    });

    it('should query markets in PendingResolution state past threshold', async () => {
      await service.getStaleMarkets(7);

      expect(marketRepo.createQueryBuilder).toHaveBeenCalledWith('m');
      expect(qb.where).toHaveBeenCalledWith('m.state = :state', { state: 2 });
      expect(qb.andWhere).toHaveBeenCalledWith('m.deadline < :threshold', {
        threshold: expect.any(Date),
      });
      expect(qb.orderBy).toHaveBeenCalledWith('m.deadline', 'ASC');
    });

    it('should use default 7 day threshold', async () => {
      const before = new Date();
      before.setDate(before.getDate() - 7);

      await service.getStaleMarkets();

      const passedThreshold = qb.andWhere.mock.calls[0][1].threshold as Date;
      expect(Math.abs(passedThreshold.getTime() - before.getTime())).toBeLessThan(1000);
    });

    it('should accept custom day threshold', async () => {
      const before = new Date();
      before.setDate(before.getDate() - 14);

      await service.getStaleMarkets(14);

      const passedThreshold = qb.andWhere.mock.calls[0][1].threshold as Date;
      expect(Math.abs(passedThreshold.getTime() - before.getTime())).toBeLessThan(1000);
    });
  });
});
