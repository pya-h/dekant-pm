import {
  Injectable,
  BadRequestException,
  ServiceUnavailableException,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
  getAccount,
} from '@solana/spl-token';
import { FaucetConfigEntity } from './entity/faucet-config.entity';
import { FaucetHistoryEntity } from './entity/faucet-history.entity';
import { CreateFaucetConfigDto } from './dto/create-faucet-config.dto';
import { UpdateFaucetConfigDto } from './dto/update-faucet-config.dto';

const NATIVE_TOKEN = 'native';

@Injectable()
export class FaucetService {
  private readonly logger = new Logger(FaucetService.name);
  private faucetKeypair: Keypair | null = null;
  private connection: Connection;

  constructor(
    @InjectRepository(FaucetConfigEntity)
    private readonly configRepo: Repository<FaucetConfigEntity>,
    @InjectRepository(FaucetHistoryEntity)
    private readonly historyRepo: Repository<FaucetHistoryEntity>,
    private readonly configService: ConfigService,
  ) {
    const rpcUrl = this.configService.get<string>('SOLANA_RPC_URL') ?? 'https://api.devnet.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.loadKeypair();
  }

  private loadKeypair() {
    const raw = this.configService.get<string>('FAUCET_KEYPAIR');
    if (!raw) {
      this.logger.warn('FAUCET_KEYPAIR not set — faucet claims will be unavailable');
      return;
    }
    try {
      const bytes = JSON.parse(raw) as number[];
      this.faucetKeypair = Keypair.fromSecretKey(Uint8Array.from(bytes));
      this.logger.log(`Faucet wallet loaded: ${this.faucetKeypair.publicKey.toBase58()}`);
    } catch (e) {
      this.logger.error('Failed to parse FAUCET_KEYPAIR — must be JSON array of bytes');
    }
  }

  private ensureKeypair(): Keypair {
    if (!this.faucetKeypair) {
      throw new ServiceUnavailableException('Faucet service not currently available');
    }
    return this.faucetKeypair;
  }

  // ── Admin CRUD ──────────────────────────────────────────────────

  async getAllConfigs(): Promise<FaucetConfigEntity[]> {
    return this.configRepo.find({ order: { createdAt: 'DESC' } });
  }

  async createConfig(dto: CreateFaucetConfigDto): Promise<FaucetConfigEntity> {
    const exists = await this.configRepo.findOne({ where: { token: dto.token } });
    if (exists) {
      throw new ConflictException(`Faucet config for token "${dto.token}" already exists`);
    }
    const config = this.configRepo.create({
      token: dto.token,
      label: dto.label,
      amountPerRequest: dto.amountPerRequest,
      maxRequestsPerDay: dto.maxRequestsPerDay,
      maxDailyAmount: dto.maxDailyAmount ?? null,
      totalAmountSharable: dto.totalAmountSharable ?? null,
      enabled: dto.enabled ?? true,
    });
    return this.configRepo.save(config);
  }

  async updateConfig(id: string, dto: UpdateFaucetConfigDto): Promise<FaucetConfigEntity> {
    const config = await this.configRepo.findOne({ where: { id } });
    if (!config) throw new NotFoundException('Faucet config not found');

    if (dto.label !== undefined) config.label = dto.label;
    if (dto.amountPerRequest !== undefined) config.amountPerRequest = dto.amountPerRequest;
    if (dto.maxRequestsPerDay !== undefined) config.maxRequestsPerDay = dto.maxRequestsPerDay;
    if (dto.maxDailyAmount !== undefined) config.maxDailyAmount = dto.maxDailyAmount;
    if (dto.totalAmountSharable !== undefined) config.totalAmountSharable = dto.totalAmountSharable;
    if (dto.enabled !== undefined) config.enabled = dto.enabled;

    return this.configRepo.save(config);
  }

  async deleteConfig(id: string): Promise<void> {
    const config = await this.configRepo.findOne({ where: { id } });
    if (!config) throw new NotFoundException('Faucet config not found');
    await this.configRepo.remove(config);
  }

  // ── Status check ────────────────────────────────────────────────

  async getStatus(userAddress: string, token: string): Promise<{
    available: boolean;
    remainingClaims: number;
    amountPerRequest: string;
    label: string;
  }> {
    if (!this.faucetKeypair) {
      return { available: false, remainingClaims: 0, amountPerRequest: '0', label: '' };
    }

    const config = await this.configRepo.findOne({ where: { token, enabled: true } });
    if (!config) {
      return { available: false, remainingClaims: 0, amountPerRequest: '0', label: '' };
    }

    const remainingClaims = await this.getRemainingClaims(userAddress, config);

    return {
      available: remainingClaims > 0,
      remainingClaims,
      amountPerRequest: config.amountPerRequest,
      label: config.label,
    };
  }

  /** Get status for all enabled tokens at once (for frontend to know which markets have faucet) */
  async getAllStatuses(userAddress: string): Promise<Array<{
    token: string;
    label: string;
    available: boolean;
    remainingClaims: number;
    amountPerRequest: string;
  }>> {
    if (!this.faucetKeypair) return [];

    const configs = await this.configRepo.find({ where: { enabled: true } });
    const results = await Promise.all(
      configs.map(async (config) => {
        const remainingClaims = await this.getRemainingClaims(userAddress, config);
        return {
          token: config.token,
          label: config.label,
          available: remainingClaims > 0,
          remainingClaims,
          amountPerRequest: config.amountPerRequest,
        };
      }),
    );
    return results;
  }

  // ── Claim ───────────────────────────────────────────────────────

  async claim(userAddress: string, token: string): Promise<{ txSignature: string; amount: string }> {
    const keypair = this.ensureKeypair();

    const config = await this.configRepo.findOne({ where: { token, enabled: true } });
    if (!config) {
      throw new BadRequestException(`No faucet available for token "${token}"`);
    }

    // Check user daily limit
    const remainingClaims = await this.getRemainingClaims(userAddress, config);
    if (remainingClaims <= 0) {
      throw new BadRequestException('Daily faucet limit reached for this token');
    }

    // Check daily global limit
    if (config.maxDailyAmount) {
      const dailyTotal = await this.getDailyTotal(config.id);
      if (BigInt(dailyTotal) + BigInt(config.amountPerRequest) > BigInt(config.maxDailyAmount)) {
        throw new BadRequestException('Global daily faucet limit reached for this token');
      }
    }

    // Check total lifetime limit
    if (config.totalAmountSharable) {
      const lifetimeTotal = await this.getLifetimeTotal(config.id);
      if (BigInt(lifetimeTotal) + BigInt(config.amountPerRequest) > BigInt(config.totalAmountSharable)) {
        throw new BadRequestException('Total faucet allocation exhausted for this token');
      }
    }

    // Execute transfer
    let txSignature: string;
    try {
      if (token === NATIVE_TOKEN) {
        txSignature = await this.transferNative(keypair, userAddress, BigInt(config.amountPerRequest));
      } else {
        txSignature = await this.transferSpl(keypair, userAddress, token, BigInt(config.amountPerRequest));
      }
    } catch (err: any) {
      this.logger.error(`Faucet transfer failed: ${err.message}`, err.stack);
      // Record failed attempt but don't count against user
      await this.historyRepo.save(
        this.historyRepo.create({
          receiver: userAddress,
          configId: config.id,
          amount: config.amountPerRequest,
          txSignature: 'failed',
          status: 'failed',
        }),
      );
      throw new ServiceUnavailableException('Faucet service not currently available');
    }

    // Record success
    await this.historyRepo.save(
      this.historyRepo.create({
        receiver: userAddress,
        configId: config.id,
        amount: config.amountPerRequest,
        txSignature,
        status: 'success',
      }),
    );

    return { txSignature, amount: config.amountPerRequest };
  }

  // ── Private helpers ─────────────────────────────────────────────

  private async getRemainingClaims(userAddress: string, config: FaucetConfigEntity): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const todayCount = await this.historyRepo.count({
      where: {
        receiver: userAddress,
        configId: config.id,
        status: 'success',
        createdAt: MoreThanOrEqual(startOfDay),
      },
    });

    return Math.max(0, config.maxRequestsPerDay - todayCount);
  }

  private async getDailyTotal(configId: string): Promise<string> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const result = await this.historyRepo
      .createQueryBuilder('h')
      .select('COALESCE(SUM(h.amount::numeric), 0)', 'total')
      .where('h.config_id = :configId', { configId })
      .andWhere('h.status = :status', { status: 'success' })
      .andWhere('h.created_at >= :startOfDay', { startOfDay })
      .getRawOne();

    return result?.total ?? '0';
  }

  private async getLifetimeTotal(configId: string): Promise<string> {
    const result = await this.historyRepo
      .createQueryBuilder('h')
      .select('COALESCE(SUM(h.amount::numeric), 0)', 'total')
      .where('h.config_id = :configId', { configId })
      .andWhere('h.status = :status', { status: 'success' })
      .getRawOne();

    return result?.total ?? '0';
  }

  private async transferNative(keypair: Keypair, to: string, lamports: bigint): Promise<string> {
    const recipient = new PublicKey(to);
    const balance = await this.connection.getBalance(keypair.publicKey);
    if (BigInt(balance) < lamports + BigInt(5000)) {
      throw new Error('Insufficient SOL balance in faucet wallet');
    }

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: recipient,
        lamports,
      }),
    );

    return sendAndConfirmTransaction(this.connection, tx, [keypair]);
  }

  private async transferSpl(
    keypair: Keypair,
    to: string,
    mintAddress: string,
    amount: bigint,
  ): Promise<string> {
    const mint = new PublicKey(mintAddress);
    const recipient = new PublicKey(to);

    // Get or create source ATA
    const sourceAta = await getOrCreateAssociatedTokenAccount(
      this.connection,
      keypair,
      mint,
      keypair.publicKey,
    );

    // Check balance
    const sourceAccount = await getAccount(this.connection, sourceAta.address);
    if (sourceAccount.amount < amount) {
      throw new Error(`Insufficient token balance in faucet wallet for mint ${mintAddress}`);
    }

    // Get or create destination ATA
    const destAta = await getOrCreateAssociatedTokenAccount(
      this.connection,
      keypair,
      mint,
      recipient,
    );

    const tx = new Transaction().add(
      createTransferInstruction(
        sourceAta.address,
        destAta.address,
        keypair.publicKey,
        amount,
      ),
    );

    return sendAndConfirmTransaction(this.connection, tx, [keypair]);
  }
}
