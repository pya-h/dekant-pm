import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { HealthModule } from '../../src/health/health.module';
import { AuthService } from '../../src/auth/auth.service';
import { AuthController } from '../../src/auth/auth.controller';
import { AuthGuard } from '../../src/auth/guard/auth.guard';
import { OptionalAuthGuard } from '../../src/auth/guard/optional-auth.guard';
import { RolesGuard } from '../../src/auth/guard/roles.guard';
import { MarketService } from '../../src/market/market.service';
import { MarketController } from '../../src/market/market.controller';
import { AmmService } from '../../src/amm/amm.service';
import { AmmController } from '../../src/amm/amm.controller';
import { UserService } from '../../src/user/user.service';
import {
  UserController,
  AdminController,
  ProfileController,
} from '../../src/user/user.controller';
import { MarketEntity } from '../../src/market/entity/market.entity';
import { TradeEntity } from '../../src/market/entity/trade.entity';
import { UserPositionEntity } from '../../src/user/entity/user-position.entity';
import { LpPositionEntity } from '../../src/user/entity/lp-position.entity';
import { UserRoleEntity } from '../../src/user/entity/user-role.entity';
import { SettingsService } from '../../src/settings/settings.service';
import { SettingsController } from '../../src/settings/settings.controller';
import { SettingEntity } from '../../src/settings/setting.entity';
import { BookmarkEntity } from '../../src/market/entity/bookmark.entity';
import { UserEntity } from '../../src/user/entity/user.entity';
import { mockMarket } from './mock-factories';

export const JWT_SECRET = 'e2e-test-secret-key-at-least-32-chars-long';
export const TEST_SUPERADMIN = 'TestWallet1111111111111111111111111111111111';

export interface TestApp {
  app: INestApplication;
  jwtService: JwtService;
  authService: AuthService;
  marketRepo: Record<string, jest.Mock>;
  tradeRepo: Record<string, jest.Mock>;
  positionRepo: Record<string, jest.Mock>;
  lpPositionRepo: Record<string, jest.Mock>;
  roleRepo: Record<string, jest.Mock>;
  settingRepo: Record<string, jest.Mock>;
  bookmarkRepo: Record<string, jest.Mock>;
  userRepo: Record<string, jest.Mock>;
  getAuthToken: (wallet?: string) => string;
}

export async function createTestApp(): Promise<TestApp> {
  const qbMock = {
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([[mockMarket()], 1]),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue({ totalVolume: '0', totalTraders: '0' }),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    setParameters: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
  };

  const marketRepo: Record<string, jest.Mock> = {
    create: jest.fn((dto: any) => dto),
    save: jest.fn((entity: any) =>
      Promise.resolve({ ...entity, id: entity.id ?? '1' }),
    ),
    findOne: jest.fn().mockResolvedValue(mockMarket()),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn().mockReturnValue(qbMock),
  };

  const tradeRepo: Record<string, jest.Mock> = {
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    count: jest.fn().mockResolvedValue(0),
    createQueryBuilder: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ total: '0' }),
    }),
  };

  const positionRepo: Record<string, jest.Mock> = {
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    createQueryBuilder: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ total: '0' }),
    }),
  };

  const lpPositionRepo: Record<string, jest.Mock> = {
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    createQueryBuilder: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ total: '0' }),
    }),
  };

  const roleRepo: Record<string, jest.Mock> = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
  };

  const settingRepo: Record<string, jest.Mock> = {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((dto: any) => dto),
    save: jest.fn((entity: any) =>
      Promise.resolve({ ...entity, id: entity.id ?? 1, updatedAt: new Date() }),
    ),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };

  const bookmarkRepo: Record<string, jest.Mock> = {
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    delete: jest.fn().mockResolvedValue({ affected: 0 }),
    createQueryBuilder: jest.fn().mockReturnValue({
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({}),
    }),
  };

  const userRepo: Record<string, jest.Mock> = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((dto: any) => dto),
    save: jest.fn((entity: any) =>
      Promise.resolve({ ...entity, id: entity.id ?? '1' }),
    ),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    }),
  };

  const dataSourceMock = {
    createQueryRunner: jest.fn().mockReturnValue({
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: { update: jest.fn() },
    }),
  };

  // Default test wallet is recognized as superadmin so existing e2e tests pass
  process.env.SUPERADMIN_ADDRESS = TEST_SUPERADMIN;

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      JwtModule.register({
        secret: JWT_SECRET,
        signOptions: { expiresIn: '1h' },
      }),
      HealthModule,
    ],
    controllers: [
      AuthController,
      MarketController,
      AmmController,
      UserController,
      AdminController,
      ProfileController,
      SettingsController,
    ],
    providers: [
      AuthService,
      AuthGuard,
      OptionalAuthGuard,
      RolesGuard,
      MarketService,
      AmmService,
      UserService,
      { provide: getRepositoryToken(MarketEntity), useValue: marketRepo },
      { provide: getRepositoryToken(TradeEntity), useValue: tradeRepo },
      {
        provide: getRepositoryToken(UserPositionEntity),
        useValue: positionRepo,
      },
      {
        provide: getRepositoryToken(LpPositionEntity),
        useValue: lpPositionRepo,
      },
      { provide: getRepositoryToken(UserRoleEntity), useValue: roleRepo },
      { provide: getRepositoryToken(SettingEntity), useValue: settingRepo },
      { provide: getRepositoryToken(BookmarkEntity), useValue: bookmarkRepo },
      { provide: getRepositoryToken(UserEntity), useValue: userRepo },
      { provide: DataSource, useValue: dataSourceMock },
      SettingsService,
    ],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();

  const jwtService = moduleFixture.get<JwtService>(JwtService);
  const authService = moduleFixture.get<AuthService>(AuthService);

  function getAuthToken(wallet = 'TestWallet1111111111111111111111111111111111'): string {
    return jwtService.sign({ sub: wallet });
  }

  return {
    app,
    jwtService,
    authService,
    marketRepo,
    tradeRepo,
    positionRepo,
    lpPositionRepo,
    roleRepo,
    settingRepo,
    bookmarkRepo,
    userRepo,
    getAuthToken,
  };
}
