import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserService } from './user.service';
import { UserPositionEntity } from './entity/user-position.entity';
import { LpPositionEntity } from './entity/lp-position.entity';
import { UserRoleEntity } from './entity/user-role.entity';
import { TradeEntity } from '../market/entity/trade.entity';
import { MarketEntity } from '../market/entity/market.entity';

describe('UserService', () => {
  let service: UserService;
  let positionRepo: Record<string, jest.Mock>;
  let lpPositionRepo: Record<string, jest.Mock>;
  let roleRepo: Record<string, jest.Mock>;
  let tradeRepo: Record<string, jest.Mock>;
  let marketRepo: Record<string, jest.Mock>;

  const WALLET = 'WaLLet111111111111111111111111111111111111111';

  beforeEach(async () => {
    positionRepo = { find: jest.fn() };
    lpPositionRepo = { find: jest.fn() };
    roleRepo = { find: jest.fn() };
    tradeRepo = { findAndCount: jest.fn() };
    marketRepo = { createQueryBuilder: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getRepositoryToken(UserPositionEntity), useValue: positionRepo },
        { provide: getRepositoryToken(LpPositionEntity), useValue: lpPositionRepo },
        { provide: getRepositoryToken(UserRoleEntity), useValue: roleRepo },
        { provide: getRepositoryToken(TradeEntity), useValue: tradeRepo },
        { provide: getRepositoryToken(MarketEntity), useValue: marketRepo },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

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
      // Should be within 1 second of 7 days ago
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
