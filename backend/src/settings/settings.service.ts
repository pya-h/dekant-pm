import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SettingEntity } from './setting.entity';

export const VALID_FEE_INTERVALS = ['none', '6h', '12h', '24h', '48h'] as const;
export type FeeCollectionInterval = (typeof VALID_FEE_INTERVALS)[number];

export const VALID_DEADLINE_INTERVALS = ['30s', '1m', '2m', '5m', '10m'] as const;
export type DeadlineCheckInterval = (typeof VALID_DEADLINE_INTERVALS)[number];

/** Map deadline interval setting to cron expression. */
export const DEADLINE_CRON: Record<DeadlineCheckInterval, string> = {
  '30s': '*/30 * * * * *',
  '1m': '0 */1 * * * *',
  '2m': '0 */2 * * * *',
  '5m': '0 */5 * * * *',
  '10m': '0 */10 * * * *',
};

/** Map deadline interval setting to milliseconds (for polling comparison). */
export const DEADLINE_INTERVAL_MS: Record<DeadlineCheckInterval, number> = {
  '30s': 30_000,
  '1m': 60_000,
  '2m': 120_000,
  '5m': 300_000,
  '10m': 600_000,
};

@Injectable()
export class SettingsService implements OnModuleInit {
  constructor(
    @InjectRepository(SettingEntity)
    private readonly repo: Repository<SettingEntity>,
  ) {}

  /** Seed a default active row on first boot. */
  async onModuleInit(): Promise<void> {
    const existing = await this.repo.findOne({ where: { isActive: true } });
    if (!existing) {
      await this.repo.save(
        this.repo.create({
          name: 'default',
          isActive: true,
          feeCollectInterval: 'none',
          deadlineCheckInterval: '1m',
        }),
      );
    }
  }

  /** Get the currently active settings row. Falls back to safe defaults. */
  async getActive(): Promise<SettingEntity> {
    const row = await this.repo.findOne({ where: { isActive: true } });
    return (
      row ??
      this.repo.create({
        name: 'default',
        isActive: true,
        feeCollectInterval: 'none',
        deadlineCheckInterval: '1m',
      })
    );
  }

  /** Get a settings row by id. */
  async getById(id: number): Promise<SettingEntity | null> {
    return this.repo.findOne({ where: { id } });
  }

  /** List all settings rows. */
  async listAll(): Promise<SettingEntity[]> {
    return this.repo.find({ order: { id: 'ASC' } });
  }

  /** Create a new settings row (inactive by default). */
  async create(
    partial: Partial<Pick<SettingEntity, 'name' | 'feeCollectInterval' | 'deadlineCheckInterval'>>,
  ): Promise<SettingEntity> {
    const row = this.repo.create({
      name: partial.name ?? 'custom',
      isActive: false,
      feeCollectInterval: partial.feeCollectInterval ?? 'none',
      deadlineCheckInterval: partial.deadlineCheckInterval ?? '1m',
    });
    return this.repo.save(row);
  }

  /** Update fields on the active settings row. */
  async update(
    partial: Partial<Pick<SettingEntity, 'feeCollectInterval' | 'deadlineCheckInterval' | 'name'>>,
  ): Promise<SettingEntity> {
    const row = await this.getActive();
    Object.assign(row, partial);
    return this.repo.save(row);
  }

  /** Activate a settings row by id (deactivates all others). */
  async activate(id: number): Promise<SettingEntity> {
    await this.repo.update({}, { isActive: false });
    await this.repo.update(id, { isActive: true });
    return this.getActive();
  }

  /** Delete a settings row. Cannot delete the active row. */
  async remove(id: number): Promise<void> {
    await this.repo.delete({ id, isActive: false });
  }

  /** Typed getter for fee collection interval. */
  async getFeeCollectionInterval(): Promise<FeeCollectionInterval> {
    const settings = await this.getActive();
    if ((VALID_FEE_INTERVALS as readonly string[]).includes(settings.feeCollectInterval)) {
      return settings.feeCollectInterval as FeeCollectionInterval;
    }
    return 'none';
  }

  /** Typed getter for deadline check interval. */
  async getDeadlineCheckInterval(): Promise<DeadlineCheckInterval> {
    const settings = await this.getActive();
    if ((VALID_DEADLINE_INTERVALS as readonly string[]).includes(settings.deadlineCheckInterval)) {
      return settings.deadlineCheckInterval as DeadlineCheckInterval;
    }
    return '1m';
  }
}
