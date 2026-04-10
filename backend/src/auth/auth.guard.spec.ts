import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let authService: Partial<AuthService>;

  beforeEach(() => {
    authService = {
      verifyToken: jest.fn().mockReturnValue({ sub: 'wallet123' }),
    };
    guard = new AuthGuard(authService as AuthService);
  });

  function createMockContext(authHeader?: string): ExecutionContext {
    const request: any = {
      headers: { authorization: authHeader },
    };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as ExecutionContext;
  }

  it('should return true for valid Bearer token', () => {
    const ctx = createMockContext('Bearer valid-token');
    expect(guard.canActivate(ctx)).toBe(true);
    expect(authService.verifyToken).toHaveBeenCalledWith('valid-token');
  });

  it('should attach walletAddress to request', () => {
    const ctx = createMockContext('Bearer valid-token');
    guard.canActivate(ctx);
    const req = ctx.switchToHttp().getRequest() as any;
    expect(req.walletAddress).toBe('wallet123');
  });

  it('should throw 401 when no authorization header', () => {
    const ctx = createMockContext(undefined);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('should throw 401 when header does not start with Bearer', () => {
    const ctx = createMockContext('Basic some-token');
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('should throw 401 when token verification fails', () => {
    (authService.verifyToken as jest.Mock).mockImplementationOnce(() => {
      throw new UnauthorizedException('Invalid token');
    });
    const ctx = createMockContext('Bearer bad-token');
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});
