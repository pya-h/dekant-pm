import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserService } from './user.service';
import { UserController, AdminController } from './user.controller';
import { UserPositionEntity } from './user-position.entity';
import { LpPositionEntity } from './lp-position.entity';
import { UserRoleEntity } from './user-role.entity';
import { TradeEntity } from '../market/trade.entity';
import { MarketEntity } from '../market/market.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserPositionEntity,
      LpPositionEntity,
      UserRoleEntity,
      TradeEntity,
      MarketEntity,
    ]),
    AuthModule,
  ],
  controllers: [UserController, AdminController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
