import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SettingEntity } from './setting.entity';

export const VALID_INTERVALS = ['none', '6h', '12h', '24h', '48h'] as const;
export type FeeCollectionInterval = (typeof VALID_INTERVALS)[number];

const SETTINGS_ID = 1;

@Injectable()
export class SettingsService implements OnModuleInit {
  constructor(
    @InjectRepository(SettingEntity)
    private readonly repo: Repository<SettingEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    const existing = await this.repo.findOne({ where: { id: SETTINGS_ID } });
    if (!existing) {
      await this.repo.save(
        this.repo.create({ id: SETTINGS_ID, feeCollectInterval: 'none' }),
      );
    }
  }

  async get(): Promise<SettingEntity> {
    const row = await this.repo.findOne({ where: { id: SETTINGS_ID } });
    return row ?? this.repo.create({ id: SETTINGS_ID, feeCollectInterval: 'none' });
  }

  async update(
    partial: Partial<Pick<SettingEntity, 'feeCollectInterval'>>,
  ): Promise<SettingEntity> {
    const row = await this.get();
    Object.assign(row, partial);
    return this.repo.save(row);
  }

  async getFeeCollectionInterval(): Promise<FeeCollectionInterval> {
    const settings = await this.get();
    if ((VALID_INTERVALS as readonly string[]).includes(settings.feeCollectInterval)) {
      return settings.feeCollectInterval as FeeCollectionInterval;
    }
    return 'none';
  }
}
