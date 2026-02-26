import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { UserPositionEntity } from './entity/user-position.entity';
import { LpPositionEntity } from './entity/lp-position.entity';
import { UserRoleEntity } from './entity/user-role.entity';
import { TradeEntity } from '../market/entity/trade.entity';
import { MarketEntity } from '../market/entity/market.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserPositionEntity)
    private readonly positionRepo: Repository<UserPositionEntity>,
    @InjectRepository(LpPositionEntity)
    private readonly lpPositionRepo: Repository<LpPositionEntity>,
    @InjectRepository(UserRoleEntity)
    private readonly roleRepo: Repository<UserRoleEntity>,
    @InjectRepository(TradeEntity)
    private readonly tradeRepo: Repository<TradeEntity>,
    @InjectRepository(MarketEntity)
    private readonly marketRepo: Repository<MarketEntity>,
  ) {}

  async getPositions(
    walletAddress: string,
  ): Promise<UserPositionEntity[]> {
    return this.positionRepo.find({
      where: { userAddress: walletAddress },
      relations: ['market'],
      order: { updatedAt: 'DESC' },
    });
  }

  async getPositionByMarket(
    walletAddress: string,
    marketId: string,
  ): Promise<UserPositionEntity | null> {
    return this.positionRepo.findOne({
      where: { userAddress: walletAddress, marketId },
      relations: ['market'],
    });
  }

  async getTradeHistory(
    walletAddress: string,
    page = 1,
    limit = 50,
  ): Promise<{ data: TradeEntity[]; total: number }> {
    const [data, total] = await this.tradeRepo.findAndCount({
      where: { trader: walletAddress },
      relations: ['market'],
      order: { timestamp: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total };
  }

  async getLpPositions(
    walletAddress: string,
  ): Promise<LpPositionEntity[]> {
    return this.lpPositionRepo.find({
      where: { userAddress: walletAddress },
      relations: ['market'],
    });
  }

  async getRoles(): Promise<UserRoleEntity[]> {
    return this.roleRepo.find({
      order: { assignedAt: 'DESC' },
    });
  }

  async getStaleMarkets(
    daysThreshold = 7,
  ): Promise<MarketEntity[]> {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - daysThreshold);

    return this.marketRepo
      .createQueryBuilder('m')
      .where('m.state = :state', { state: 2 }) // PendingResolution
      .andWhere('m.deadline < :threshold', { threshold })
      .orderBy('m.deadline', 'ASC')
      .getMany();
  }
}
