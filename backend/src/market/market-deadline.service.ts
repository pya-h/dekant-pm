import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { MarketEntity } from './entity/market.entity';

/** On-chain market state constants */
const STATE_ACTIVE = 0;
const STATE_PENDING_RESOLUTION = 2;

@Injectable()
export class MarketDeadlineService {
  private readonly logger = new Logger(MarketDeadlineService.name);
  private running = false;

  constructor(
    @InjectRepository(MarketEntity)
    private readonly marketRepo: Repository<MarketEntity>,
  ) {}

  /**
   * Runs every 30 seconds.
   * Finds Active markets whose deadline has passed and transitions them
   * to PendingResolution (state=2) in the DB.
   *
   * The on-chain program enforces the same rule lazily (on next interaction),
   * but this cron ensures the backend/frontend reflects the correct state
   * without waiting for a trade attempt.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async closeExpiredMarkets(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const now = new Date();

      const expired = await this.marketRepo.find({
        where: {
          state: STATE_ACTIVE,
          deadline: LessThanOrEqual(now),
        },
        select: ['id', 'title', 'deadline'],
      });

      if (expired.length === 0) return;

      for (const market of expired) {
        await this.marketRepo.update(market.id, {
          state: STATE_PENDING_RESOLUTION,
        });
        this.logger.log(
          `Market ${market.id} ("${market.title}") closed — deadline ${market.deadline.toISOString()} has passed`,
        );
      }

      this.logger.log(
        `Deadline sweep: ${expired.length} market(s) transitioned to PendingResolution`,
      );
    } catch (err) {
      this.logger.error(`Deadline sweep failed: ${err}`);
    } finally {
      this.running = false;
    }
  }
}
