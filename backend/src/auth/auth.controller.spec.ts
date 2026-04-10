import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: Partial<AuthService>;

  beforeEach(async () => {
    authService = {
      createChallenge: jest.fn().mockReturnValue({
        nonce: 'test-nonce',
        message: 'test-message',
      }),
      verifySignature: jest.fn().mockReturnValue({
        accessToken: 'test-jwt',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /auth/challenge', () => {
    it('should call authService.createChallenge with walletAddress', () => {
      const dto = { walletAddress: 'SomeWalletAddress' };
      const result = controller.createChallenge(dto);
      expect(authService.createChallenge).toHaveBeenCalledWith(
        'SomeWalletAddress',
      );
      expect(result).toEqual({ nonce: 'test-nonce', message: 'test-message' });
    });
  });

  describe('POST /auth/verify', () => {
    it('should call authService.verifySignature with dto fields', () => {
      const dto = {
        walletAddress: 'SomeWallet',
        signature: 'sig123',
        nonce: 'nonce456',
      };
      const result = controller.verify(dto);
      expect(authService.verifySignature).toHaveBeenCalledWith(
        'SomeWallet',
        'sig123',
        'nonce456',
      );
      expect(result).toEqual({ accessToken: 'test-jwt' });
    });
  });
});
