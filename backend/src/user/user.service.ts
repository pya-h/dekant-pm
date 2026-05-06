import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from './entity/user.entity';
import { UserPositionEntity } from './entity/user-position.entity';
import { LpPositionEntity } from './entity/lp-position.entity';
import { UserRoleEntity } from './entity/user-role.entity';
import { TradeEntity } from '../market/entity/trade.entity';
import { MarketEntity } from '../market/entity/market.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { randomBytes } from 'crypto';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
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

  /** Get or create user by wallet address. */
  async findOrCreateUser(walletAddress: string): Promise<UserEntity> {
    const existing = await this.userRepo.findOne({ where: { walletAddress } });
    if (existing) return existing;

    const username = 'user_' + randomBytes(4).toString('hex');
    const user = this.userRepo.create({
      walletAddress,
      username,
    });
    return this.userRepo.save(user);
  }

  /** Get user profile by wallet address (returns null if not found). */
  async getProfile(walletAddress: string): Promise<UserEntity | null> {
    return this.userRepo.findOne({ where: { walletAddress } });
  }

  /** Update user profile. Only updates provided fields. */
  async updateProfile(
    walletAddress: string,
    dto: UpdateProfileDto,
  ): Promise<UserEntity> {
    const user = await this.findOrCreateUser(walletAddress);

    if (dto.username !== undefined && dto.username !== user.username) {
      const taken = await this.userRepo.findOne({
        where: { username: dto.username },
      });
      if (taken && taken.walletAddress !== walletAddress) {
        throw new ConflictException('Username is already taken');
      }
      user.username = dto.username;
    }

    if (dto.email !== undefined && dto.email !== user.email) {
      if (dto.email !== null && dto.email !== '') {
        const taken = await this.userRepo.findOne({
          where: { email: dto.email },
        });
        if (taken && taken.walletAddress !== walletAddress) {
          throw new ConflictException('Email is already taken');
        }
      }
      user.email = dto.email || null;
    }

    if (dto.avatar !== undefined) {
      user.avatar = dto.avatar || null;
    }

    return this.userRepo.save(user);
  }

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
