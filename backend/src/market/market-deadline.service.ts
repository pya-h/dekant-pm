import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { MarketEntity } from './entity/market.entity';
import {
  SettingsService,
  DeadlineCheckInterval,
  DEADLINE_INTERVAL_MS,
} from '../settings/settings.service';

/** On-chain market state constants */
const STATE_ACTIVE = 0;
const STATE_PENDING_RESOLUTION = 2;

@Injectable()
export class MarketDeadlineService {
  private readonly logger = new Logger(MarketDeadlineService.name);
  private running = false;
  private lastCheckTime = 0;

  constructor(
    @InjectRepository(MarketEntity)
    private readonly marketRepo: Repository<MarketEntity>,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * Ticks every 30 seconds. Checks the configured deadline_check_interval
   * and only runs the sweep when enough time has elapsed.
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async tick(): Promise<void> {
    if (this.running) return;

    const interval = await this.settingsService.getDeadlineCheckInterval();
    const intervalMs = DEADLINE_INTERVAL_MS[interval];
    if (Date.now() - this.lastCheckTime < intervalMs) return;

    this.running = true;
    try {
      await this.closeExpiredMarkets();
      this.lastCheckTime = Date.now();
    } catch (err) {
      this.logger.error(`Deadline sweep failed: ${err}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Finds Active markets whose deadline has passed and transitions them
   * to PendingResolution (state=2) in the DB.
   *
   * The on-chain program enforces the same rule lazily (on next interaction),
   * but this cron ensures the backend/frontend reflects the correct state
   * without waiting for a trade attempt.
   */
  async closeExpiredMarkets(): Promise<void> {
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
  }
}
