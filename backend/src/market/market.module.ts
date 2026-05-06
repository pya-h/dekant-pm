import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MarketEntity } from './entity/market.entity';
import { TradeEntity } from './entity/trade.entity';
import { BookmarkEntity } from './entity/bookmark.entity';
import { MarketService } from './market.service';
import { MarketDeadlineService } from './market-deadline.service';
import { MarketController } from './market.controller';
import { AuthModule } from '../auth/auth.module';
import { SettingsModule } from '../settings/settings.module';
import { UserRoleEntity } from '../user/entity/user-role.entity';
import { UserEntity } from '../user/entity/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MarketEntity,
      TradeEntity,
      BookmarkEntity,
      UserRoleEntity,
      UserEntity,
    ]),
    AuthModule,
    SettingsModule,
  ],
  controllers: [MarketController],
  providers: [MarketService, MarketDeadlineService],
  exports: [MarketService],
})
export class MarketModule {}
