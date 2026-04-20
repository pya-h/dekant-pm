import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRoleEntity } from '../../user/entity/user-role.entity';
import { ROLES_KEY } from '../decorator/roles.decorator';

/** Maps role name strings to on-chain / DB numeric values. */
const ROLE_NAME_TO_NUM: Record<string, number> = {
  admin: 1,
  oracle: 2,
  creator: 3,
};

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly superadminAddress: string | undefined;

  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(UserRoleEntity)
    private readonly userRoleRepo: Repository<UserRoleEntity>,
    configService: ConfigService,
  ) {
    this.superadminAddress = configService.get<string>('SUPERADMIN_ADDRESS');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No @Roles() decorator on handler or class → no role restriction
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const walletAddress: string | undefined = request.walletAddress;

    if (!walletAddress) {
      throw new ForbiddenException('No wallet address on request');
    }

    // Superadmin implicitly satisfies any role requirement
    if (this.superadminAddress && walletAddress === this.superadminAddress) {
      return true;
    }

    // Query the user's DB roles
    const userRoles = await this.userRoleRepo.find({
      where: { userAddress: walletAddress },
      select: ['role'],
    });
    const userRoleNums = new Set(userRoles.map((r) => r.role));

    // Check if any of the user's roles satisfies a required role
    for (const required of requiredRoles) {
      if (required === 'superadmin') {
        // Already checked via env address above — DB has no superadmin role
        continue;
      }
      const num = ROLE_NAME_TO_NUM[required];
      if (num !== undefined && userRoleNums.has(num)) {
        return true;
      }
    }

    throw new ForbiddenException('Insufficient role permissions');
  }
}
