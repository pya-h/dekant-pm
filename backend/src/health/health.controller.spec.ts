import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return { status: "ok" }', () => {
    const result = controller.check();
    expect(result).toEqual({ status: 'ok' });
  });

  it('should return an object with exactly one key', () => {
    const result = controller.check();
    expect(Object.keys(result)).toHaveLength(1);
  });
});
