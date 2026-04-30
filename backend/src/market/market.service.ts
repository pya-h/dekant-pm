import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarketEntity } from './entity/market.entity';
import { TradeEntity } from './entity/trade.entity';
import { CreateMarketDto } from './dto/create-market.dto';
import { MarketFilterDto } from './dto/market-filter.dto';

const SCALE = 1_000_000_000;

@Injectable()
export class MarketService {
  constructor(
    @InjectRepository(MarketEntity)
    private readonly marketRepo: Repository<MarketEntity>,
    @InjectRepository(TradeEntity)
    private readonly tradeRepo: Repository<TradeEntity>,
  ) {}

  async create(dto: CreateMarketDto): Promise<MarketEntity> {
    const id = String(dto.marketId);
    const existing = await this.marketRepo.findOne({ where: { id } });

    if (existing) {
      // Indexer may have already inserted this row with a generic title.
      // Only update off-chain metadata — on-chain fields (creator, oracle,
      // collateralMint, deadline, reserves, etc.) come from the indexer
      // which uses program data as the source of truth.
      // Fall back to DTO values for on-chain fields only if the indexer
      // hasn't populated them yet.
      existing.title = dto.title;
      existing.description = dto.description ?? null;
      existing.category = dto.category ?? null;
      existing.tags = dto.tags ?? null;
      existing.imageUrl = dto.imageUrl ?? null;
      existing.outcomeLabels = dto.outcomeLabels ?? null;
      if (!existing.creator) existing.creator = dto.creator;
      if (!existing.oracle) existing.oracle = dto.oracle;
      if (!existing.collateralMint) existing.collateralMint = dto.collateralMint;
      if (!existing.deadline) existing.deadline = new Date(dto.deadline);
      if (existing.rangeMin == null && dto.rangeMin != null)
        existing.rangeMin = String(dto.rangeMin);
      if (existing.rangeMax == null && dto.rangeMax != null)
        existing.rangeMax = String(dto.rangeMax);
      return this.marketRepo.save(existing);
    }

    const initialReserves = Array(dto.numOutcomes).fill('0');

    const market = this.marketRepo.create({
      id,
      pubkey: dto.pubkey,
      marketType: dto.marketType,
      state: 0,
      creator: dto.creator,
      oracle: dto.oracle,
      collateralMint: dto.collateralMint,
      deadline: new Date(dto.deadline),
      numOutcomes: dto.numOutcomes,
      title: dto.title,
      description: dto.description ?? null,
      category: dto.category ?? null,
      tags: dto.tags ?? null,
      imageUrl: dto.imageUrl ?? null,
      outcomeLabels: dto.outcomeLabels ?? null,
      reserves: initialReserves,
      kSquared: '0',
      totalMinted: '0',
      rangeMin: dto.rangeMin != null ? String(dto.rangeMin) : null,
      rangeMax: dto.rangeMax != null ? String(dto.rangeMax) : null,
    });

    return this.marketRepo.save(market);
  }

  async findAll(
    filters: MarketFilterDto,
  ): Promise<{ data: MarketEntity[]; total: number }> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const offset = (page - 1) * limit;

    const qb = this.marketRepo.createQueryBuilder('m');

    if (filters.category) {
      qb.andWhere('m.category = :category', { category: filters.category });
    }

    if (filters.marketType !== undefined) {
      qb.andWhere('m.market_type = :marketType', {
        marketType: filters.marketType,
      });
    }

    if (filters.state !== undefined) {
      qb.andWhere('m.state = :state', { state: filters.state });
    }

    if (filters.oracle) {
      qb.andWhere('m.oracle = :oracle', { oracle: filters.oracle });
    }

    if (filters.search) {
      const escaped = filters.search.replace(/[\\%_]/g, '\\$&');
      qb.andWhere("m.title ILIKE :search ESCAPE '\\'", {
        search: `%${escaped}%`,
      });
    }

    switch (filters.sortBy) {
      case 'deadline':
        qb.orderBy('m.deadline', 'ASC');
        break;
      case 'volume':
        qb.orderBy('m.total_volume', 'DESC');
        break;
      default:
        qb.orderBy('m.created_at', 'DESC');
    }

    qb.skip(offset).take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async findById(id: number): Promise<MarketEntity> {
    const market = await this.marketRepo.findOne({
      where: { id: String(id) },
    });
    if (!market) {
      throw new NotFoundException(`Market ${id} not found`);
    }
    return market;
  }

  async getPrices(id: number): Promise<{ probabilities: number[] }> {
    const market = await this.findById(id);
    const reserves = market.reserves.map(Number);
    const totalMinted = Number(market.totalMinted);

    if (totalMinted === 0) {
      const uniform = 1 / reserves.length;
      return { probabilities: reserves.map(() => uniform) };
    }

    // p̂_i = x_i² / k² where k = totalMinted (per L2-norm AMM math)
    const kSq = totalMinted * totalMinted;
    const probabilities = reserves.map((r) => {
      const x = totalMinted - r;
      return (x * x) / kSq;
    });

    return { probabilities };
  }

  async getHistory(
    id: number,
    page = 1,
    limit = 50,
  ): Promise<{ data: TradeEntity[]; total: number }> {
    const [data, total] = await this.tradeRepo.findAndCount({
      where: { marketId: String(id) },
      order: { timestamp: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total };
  }

  async updateCachedState(
    id: number,
    onChainData: Partial<
      Pick<
        MarketEntity,
        | 'reserves'
        | 'kSquared'
        | 'totalMinted'
        | 'state'
        | 'resolvedOutcome'
        | 'resolvedValue'
        | 'resolvedAt'
      >
    >,
  ): Promise<void> {
    await this.marketRepo.update(String(id), onChainData);
  }

}
