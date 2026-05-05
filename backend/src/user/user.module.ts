import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserService } from './user.service';
import { UserController, AdminController, ProfileController } from './user.controller';
import { UserEntity } from './entity/user.entity';
import { UserPositionEntity } from './entity/user-position.entity';
import { LpPositionEntity } from './entity/lp-position.entity';
import { UserRoleEntity } from './entity/user-role.entity';
import { TradeEntity } from '../market/entity/trade.entity';
import { MarketEntity } from '../market/entity/market.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      UserPositionEntity,
      LpPositionEntity,
      UserRoleEntity,
      TradeEntity,
      MarketEntity,
    ]),
    forwardRef(() => AuthModule),
  ],
  controllers: [UserController, AdminController, ProfileController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
