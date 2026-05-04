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
    const category = dto.category?.trim() || 'crypto';
    const subject = dto.subject?.trim() || 'SOL';
    const icon = dto.icon?.trim() || null;

    if (existing) {
      // Indexer may have already inserted this row with a generic title.
      // Only update off-chain metadata — on-chain fields (creator, oracle,
      // collateralMint, deadline, reserves, etc.) come from the indexer
      // which uses program data as the source of truth.
      // Fall back to DTO values for on-chain fields only if the indexer
      // hasn't populated them yet.
      existing.title = dto.title;
      existing.description = dto.description ?? null;
      existing.category = dto.category?.trim() || existing.category || 'crypto';
      existing.subject = dto.subject?.trim() || existing.subject || 'SOL';
      existing.tags = dto.tags ?? null;
      existing.icon = dto.icon?.trim() || existing.icon || null;
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
      category,
      subject,
      tags: dto.tags ?? null,
      icon,
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
  ): Promise<{ data: MarketEntity[]; total: number; stats?: { totalVolume: string; totalTraders: number } }> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const offset = (page - 1) * limit;

    const qb = this.marketRepo.createQueryBuilder('m');

    if (filters.category) {
      qb.andWhere('m.category = :category', { category: filters.category });
    }

    if (filters.subject) {
      qb.andWhere('m.subject = :subject', { subject: filters.subject });
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

    if (filters.creator) {
      qb.andWhere('m.creator = :creator', { creator: filters.creator });
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

    let stats: { totalVolume: string; totalTraders: number } | undefined;
    if (filters.includeStats) {
      const statsQb = this.marketRepo.createQueryBuilder('m')
        .select('COALESCE(SUM(m.total_volume), 0)', 'totalVolume')
        .addSelect('COALESCE(SUM(m.total_traders), 0)', 'totalTraders');
      if (filters.creator) {
        statsQb.andWhere('m.creator = :creator', { creator: filters.creator });
      }
      const raw = await statsQb.getRawOne();
      stats = {
        totalVolume: String(raw.totalVolume),
        totalTraders: Number(raw.totalTraders),
      };
    }

    return { data, total, ...(stats && { stats }) };
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

  async getOracleData(
    id: number,
  ): Promise<{
    distributionPeak: number | null;
    mostLikelyRange: [number, number] | null;
    confidence95: [number, number] | null;
  }> {
    const market = await this.findById(id);

    // Oracle data only applies to continuous markets
    if (market.marketType !== 2 || market.rangeMin == null || market.rangeMax == null) {
      return { distributionPeak: null, mostLikelyRange: null, confidence95: null };
    }

    const rMin = Number(market.rangeMin) / SCALE;
    const rMax = Number(market.rangeMax) / SCALE;
    const range = rMax - rMin;

    // Compute probabilities to find the peak bin
    const reserves = market.reserves.map(Number);
    const totalMinted = Number(market.totalMinted);
    const kSq = Number(market.kSquared) || totalMinted * totalMinted;

    let peakBin = 0;
    if (totalMinted > 0 && kSq > 0) {
      let maxProb = 0;
      for (let i = 0; i < reserves.length; i++) {
        const x = totalMinted - reserves[i];
        const prob = (x * x) / kSq;
        if (prob > maxProb) {
          maxProb = prob;
          peakBin = i;
        }
      }
    } else {
      // Uniform — pick center bin
      peakBin = Math.floor(reserves.length / 2);
    }

    const binWidth = range / market.numOutcomes;
    const peak = rMin + binWidth * (peakBin + 0.5);

    // Most likely range: peak bin +/- 1 bin
    const mlrLow = Math.max(rMin, rMin + binWidth * (peakBin - 1));
    const mlrHigh = Math.min(rMax, rMin + binWidth * (peakBin + 2));

    // 95% confidence: peak bin +/- ~3 bins (wider spread)
    const spread = Math.max(3, Math.floor(market.numOutcomes * 0.2));
    const c95Low = Math.max(rMin, rMin + binWidth * (peakBin - spread));
    const c95High = Math.min(rMax, rMin + binWidth * (peakBin + spread + 1));

    return {
      distributionPeak: Math.round(peak * 100) / 100,
      mostLikelyRange: [Math.round(mlrLow * 100) / 100, Math.round(mlrHigh * 100) / 100],
      confidence95: [Math.round(c95Low * 100) / 100, Math.round(c95High * 100) / 100],
    };
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
