import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Decorator that marks an endpoint as requiring one or more roles.
 * Use with RolesGuard: @UseGuards(AuthGuard, RolesGuard)
 *
 * Accepted values: 'superadmin', 'admin', 'oracle', 'creator'
 * Superadmin (env-based) implicitly satisfies any role requirement.
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
