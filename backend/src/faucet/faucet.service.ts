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
import * as fs from 'fs';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { FaucetConfigEntity } from './entity/faucet-config.entity';
import { FaucetHistoryEntity } from './entity/faucet-history.entity';
import { CreateFaucetConfigDto } from './dto/create-faucet-config.dto';
import { UpdateFaucetConfigDto } from './dto/update-faucet-config.dto';

const NATIVE_TOKEN = 'native';
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

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
    const keypairPath = this.configService.get<string>('FAUCET_KEYPAIR');
    if (!keypairPath) {
      this.logger.warn('FAUCET_KEYPAIR not set — faucet claims will be unavailable');
      return;
    }
    try {
      const resolved = keypairPath.replace(/^~/, process.env.HOME || '');
      const raw = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
      this.faucetKeypair = Keypair.fromSecretKey(Uint8Array.from(raw));
      this.logger.log(`Faucet wallet loaded: ${this.faucetKeypair.publicKey.toBase58()}`);
    } catch (e) {
      this.logger.error(`Failed to load faucet keypair from file: ${e}`);
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

  /** Get status for all enabled tokens at once */
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

    // Derive ATAs
    const sourceAta = this.getAssociatedTokenAddress(mint, keypair.publicKey);
    const destAta = this.getAssociatedTokenAddress(mint, recipient);

    // Check source balance
    const sourceInfo = await this.connection.getAccountInfo(sourceAta);
    if (!sourceInfo) {
      throw new Error('Faucet wallet has no token account for this mint');
    }
    // SPL Token account data: first 64 bytes are mint + owner, bytes 64-72 are amount (u64 LE)
    const currentBalance = sourceInfo.data.readBigUInt64LE(64);
    if (currentBalance < amount) {
      throw new Error(`Insufficient token balance in faucet wallet for mint ${mintAddress}`);
    }

    const tx = new Transaction();

    // Create destination ATA if it doesn't exist
    const destInfo = await this.connection.getAccountInfo(destAta);
    if (!destInfo) {
      tx.add(this.createAssociatedTokenAccountInstruction(keypair.publicKey, destAta, recipient, mint));
    }

    // Add transfer instruction
    tx.add(this.createSplTransferInstruction(sourceAta, destAta, keypair.publicKey, amount));

    return sendAndConfirmTransaction(this.connection, tx, [keypair]);
  }

  /** Derive the associated token address (PDA) */
  private getAssociatedTokenAddress(mint: PublicKey, owner: PublicKey): PublicKey {
    const [address] = PublicKey.findProgramAddressSync(
      [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    return address;
  }

  /** Create ATA instruction */
  private createAssociatedTokenAccountInstruction(
    payer: PublicKey,
    ata: PublicKey,
    owner: PublicKey,
    mint: PublicKey,
  ): TransactionInstruction {
    return new TransactionInstruction({
      keys: [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: ata, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      programId: ASSOCIATED_TOKEN_PROGRAM_ID,
      data: Buffer.alloc(0),
    });
  }

  /** SPL Token Transfer instruction (index = 3) */
  private createSplTransferInstruction(
    source: PublicKey,
    destination: PublicKey,
    authority: PublicKey,
    amount: bigint,
  ): TransactionInstruction {
    const data = Buffer.alloc(9);
    data.writeUInt8(3, 0); // Transfer instruction index
    data.writeBigUInt64LE(amount, 1);
    return new TransactionInstruction({
      keys: [
        { pubkey: source, isSigner: false, isWritable: true },
        { pubkey: destination, isSigner: false, isWritable: true },
        { pubkey: authority, isSigner: true, isWritable: false },
      ],
      programId: TOKEN_PROGRAM_ID,
      data,
    });
  }
}
