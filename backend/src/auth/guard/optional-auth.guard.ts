import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthService } from '../auth.service';
import { Request } from 'express';

/**
 * Like AuthGuard, but does NOT throw if the token is missing or invalid.
 * It just sets `request.walletAddress` when a valid token is present.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.slice(7);
        const payload = this.authService.verifyToken(token);
        (request as any).walletAddress = payload.sub;
      } catch {
        // Invalid token — proceed unauthenticated
      }
    }

    return true;
  }
}
