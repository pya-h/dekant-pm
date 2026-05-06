import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FaucetConfigEntity } from './entity/faucet-config.entity';
import { FaucetHistoryEntity } from './entity/faucet-history.entity';
import { FaucetService } from './faucet.service';
import { FaucetController } from './faucet.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([FaucetConfigEntity, FaucetHistoryEntity]),
    AuthModule,
  ],
  controllers: [FaucetController],
  providers: [FaucetService],
  exports: [FaucetService],
})
export class FaucetModule {}
