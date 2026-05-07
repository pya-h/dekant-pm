import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarketEntity } from '../market/entity/market.entity';

export interface TokenPrice {
  token_id: string;
  price: number;
  ema_price: number;
  confidence: number;
  timestamp: string;
  stale?: boolean;
}

export interface MarketPriceResult {
  marketId: string;
  subject: string;
  price: TokenPrice;
}

@Injectable()
export class PriceService {
  private readonly logger = new Logger(PriceService.name);
  private readonly baseUrl: string;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(MarketEntity)
    private readonly marketRepo: Repository<MarketEntity>,
  ) {
    this.baseUrl =
      this.config.get<string>('PRICESERVICE_URL') ??
      'https://xprices.umbralabs.io';
  }

  async getMarketPrice(marketId: string): Promise<MarketPriceResult> {
    const market = await this.marketRepo.findOne({ where: { id: marketId } });
    if (!market) {
      throw new MarketNotFoundError(marketId);
    }

    if (market.category !== 'crypto') {
      throw new NonCryptoCategoryError(market.category);
    }

    const token = market.subject.toUpperCase();
    const price = await this.fetchTokenPrice(token);

    return {
      marketId: market.id,
      subject: market.subject,
      price,
    };
  }

  private async fetchTokenPrice(token: string): Promise<TokenPrice> {
    const url = `${this.baseUrl}/prices/${token}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    try {
      const res = await fetch(url, { signal: controller.signal });

      if (res.status === 404) {
        throw new TokenNotFoundError(token);
      }
      if (!res.ok) {
        throw new Error(`Price service returned ${res.status}`);
      }

      return (await res.json()) as TokenPrice;
    } catch (err) {
      if (err instanceof TokenNotFoundError) throw err;
      if (err instanceof DOMException && err.name === 'AbortError') {
        this.logger.warn(`Price fetch timed out for ${token}`);
        throw new Error('Price service timed out');
      }
      this.logger.warn(`Price fetch failed for ${token}: ${err}`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

export class MarketNotFoundError extends Error {
  constructor(id: string) {
    super(`Market ${id} not found`);
    this.name = 'MarketNotFoundError';
  }
}

export class NonCryptoCategoryError extends Error {
  constructor(category: string | null) {
    super(`Market category "${category}" is not crypto`);
    this.name = 'NonCryptoCategoryError';
  }
}

export class TokenNotFoundError extends Error {
  constructor(token: string) {
    super(`Token "${token}" not found in price service`);
    this.name = 'TokenNotFoundError';
  }
}
