import {
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { RolesGuard } from './roles.guard';
import { UserRoleEntity } from '../../user/entity/user-role.entity';
import { ROLES_KEY } from '../decorator/roles.decorator';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;
  let roleRepo: Partial<Repository<UserRoleEntity>>;
  let configService: Partial<ConfigService>;

  const SUPERADMIN = 'SuperAdmin11111111111111111111111111111111111';
  const ADMIN_WALLET = 'AdminWallet1111111111111111111111111111111111';
  const ORACLE_WALLET = 'OracleWallet111111111111111111111111111111111';
  const REGULAR_WALLET = 'RegularWallet11111111111111111111111111111111';

  function createContext(walletAddress?: string): ExecutionContext {
    const request: any = { walletAddress };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as ExecutionContext;
  }

  beforeEach(() => {
    reflector = new Reflector();
    roleRepo = {
      find: jest.fn().mockResolvedValue([]),
    };
    configService = {
      get: jest.fn().mockReturnValue(SUPERADMIN),
    };
    guard = new RolesGuard(
      reflector,
      roleRepo as Repository<UserRoleEntity>,
      configService as ConfigService,
    );
  });

  // ── No @Roles metadata ────────────────────────────────────────────

  it('should allow request when no @Roles() metadata is set', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(await guard.canActivate(createContext(REGULAR_WALLET))).toBe(true);
    expect(roleRepo.find).not.toHaveBeenCalled();
  });

  it('should allow request when @Roles() has empty array', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([]);
    expect(await guard.canActivate(createContext(REGULAR_WALLET))).toBe(true);
  });

  // ── Superadmin bypass ─────────────────────────────────────────────

  it('should allow superadmin for any required role', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    expect(await guard.canActivate(createContext(SUPERADMIN))).toBe(true);
    expect(roleRepo.find).not.toHaveBeenCalled();
  });

  it('should allow superadmin even when @Roles("superadmin") is required', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['superadmin']);
    expect(await guard.canActivate(createContext(SUPERADMIN))).toBe(true);
  });

  // ── Admin role ────────────────────────────────────────────────────

  it('should allow wallet with admin role (1) when @Roles("admin")', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    (roleRepo.find as jest.Mock).mockResolvedValueOnce([{ role: 1 }]);
    expect(await guard.canActivate(createContext(ADMIN_WALLET))).toBe(true);
  });

  it('should reject wallet with admin role when @Roles("superadmin") only', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['superadmin']);
    (roleRepo.find as jest.Mock).mockResolvedValueOnce([{ role: 1 }]);
    await expect(guard.canActivate(createContext(ADMIN_WALLET)))
      .rejects.toThrow(ForbiddenException);
  });

  // ── Oracle role ───────────────────────────────────────────────────

  it('should allow wallet with oracle role (2) when @Roles("oracle")', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['oracle']);
    (roleRepo.find as jest.Mock).mockResolvedValueOnce([{ role: 2 }]);
    expect(await guard.canActivate(createContext(ORACLE_WALLET))).toBe(true);
  });

  it('should reject oracle when @Roles("admin") is required', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    (roleRepo.find as jest.Mock).mockResolvedValueOnce([{ role: 2 }]);
    await expect(guard.canActivate(createContext(ORACLE_WALLET)))
      .rejects.toThrow(ForbiddenException);
  });

  // ── Creator role ──────────────────────────────────────────────────

  it('should allow wallet with creator role (3) when @Roles("creator")', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['creator']);
    (roleRepo.find as jest.Mock).mockResolvedValueOnce([{ role: 3 }]);
    expect(await guard.canActivate(createContext('CreatorWallet'))).toBe(true);
  });

  // ── No roles in DB ────────────────────────────────────────────────

  it('should reject wallet with no roles when @Roles("admin")', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    (roleRepo.find as jest.Mock).mockResolvedValueOnce([]);
    await expect(guard.canActivate(createContext(REGULAR_WALLET)))
      .rejects.toThrow(ForbiddenException);
  });

  it('should reject wallet with no roles when @Roles("superadmin")', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['superadmin']);
    (roleRepo.find as jest.Mock).mockResolvedValueOnce([]);
    await expect(guard.canActivate(createContext(REGULAR_WALLET)))
      .rejects.toThrow(ForbiddenException);
  });

  // ── Multiple roles on decorator ───────────────────────────────────

  it('should allow if user has any one of multiple required roles', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin', 'oracle']);
    (roleRepo.find as jest.Mock).mockResolvedValueOnce([{ role: 2 }]); // oracle
    expect(await guard.canActivate(createContext(ORACLE_WALLET))).toBe(true);
  });

  it('should reject if user has none of the multiple required roles', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin', 'oracle']);
    (roleRepo.find as jest.Mock).mockResolvedValueOnce([{ role: 3 }]); // creator only
    await expect(guard.canActivate(createContext('CreatorWallet')))
      .rejects.toThrow(ForbiddenException);
  });

  // ── Multiple roles on user ────────────────────────────────────────

  it('should allow if user has multiple roles and one matches', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['oracle']);
    (roleRepo.find as jest.Mock).mockResolvedValueOnce([{ role: 1 }, { role: 2 }]);
    expect(await guard.canActivate(createContext(ADMIN_WALLET))).toBe(true);
  });

  // ── Missing walletAddress ─────────────────────────────────────────

  it('should throw ForbiddenException when walletAddress is missing', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    await expect(guard.canActivate(createContext(undefined)))
      .rejects.toThrow(ForbiddenException);
  });

  // ── DB query failure ──────────────────────────────────────────────

  it('should propagate DB errors (not silently allow)', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    (roleRepo.find as jest.Mock).mockRejectedValueOnce(new Error('DB down'));
    await expect(guard.canActivate(createContext(REGULAR_WALLET)))
      .rejects.toThrow('DB down');
  });

  // ── Missing SUPERADMIN_ADDRESS env ────────────────────────────────

  it('should not bypass for any wallet when SUPERADMIN_ADDRESS is unset', async () => {
    const noEnvConfig = { get: jest.fn().mockReturnValue(undefined) } as any;
    const guardNoEnv = new RolesGuard(
      reflector,
      roleRepo as Repository<UserRoleEntity>,
      noEnvConfig,
    );
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    (roleRepo.find as jest.Mock).mockResolvedValueOnce([]);
    await expect(guardNoEnv.canActivate(createContext(SUPERADMIN)))
      .rejects.toThrow(ForbiddenException);
  });

  // ── Unknown role name in decorator ────────────────────────────────

  it('should reject when decorator has an unknown role name', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['nonexistent']);
    (roleRepo.find as jest.Mock).mockResolvedValueOnce([{ role: 1 }]);
    await expect(guard.canActivate(createContext(ADMIN_WALLET)))
      .rejects.toThrow(ForbiddenException);
  });
});
