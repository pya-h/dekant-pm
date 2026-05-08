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
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { FaucetConfigEntity } from './entity/faucet-config.entity';
import { FaucetHistoryEntity } from './entity/faucet-history.entity';
import { CreateFaucetConfigDto } from './dto/create-faucet-config.dto';
import { UpdateFaucetConfigDto } from './dto/update-faucet-config.dto';

const NATIVE_TOKEN = 'native';
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

@Injectable()
export class FaucetService {
  private readonly logger = new Logger(FaucetService.name);
  private faucetKeypair: Keypair | null = null;
  private connection: Connection;
  /** Lamports of SOL to airdrop alongside every faucet claim (0 = disabled). */
  private supportingSolLamports: bigint;

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

    const supportingSol = parseFloat(
      this.configService.get<string>('SUPPORTING_SOL_FAUCET') ?? '0.03',
    );
    this.supportingSolLamports = BigInt(Math.round((isNaN(supportingSol) ? 0 : supportingSol) * 1e9));
  }

  private loadKeypair() {
    const keypairJson = this.configService.get<string>('FAUCET_KEYPAIR');
    if (!keypairJson) {
      this.logger.warn('FAUCET_KEYPAIR not set — faucet claims will be unavailable');
      return;
    }
    try {
      const raw = JSON.parse(keypairJson);
      this.faucetKeypair = Keypair.fromSecretKey(Uint8Array.from(raw));
      this.logger.log(`Faucet wallet loaded: ${this.faucetKeypair.publicKey.toBase58()}`);
    } catch (e) {
      this.logger.error(`Failed to parse FAUCET_KEYPAIR: ${e}`);
    }
  }

  private ensureKeypair(): Keypair {
    if (!this.faucetKeypair) {
      throw new ServiceUnavailableException('Faucet service not available right now');
    }
    return this.faucetKeypair;
  }

  // ── Admin CRUD ──────────────────────────────────────────────────

  /** Resolve display label: explicit label > "SOL" for native > truncated address */
  private resolveLabel(config: FaucetConfigEntity): string {
    if (config.label) return config.label;
    if (config.token === NATIVE_TOKEN) return 'SOL';
    return config.token.slice(0, 4) + '\u2026' + config.token.slice(-4);
  }

  /** Convert human-readable amount to raw (lamports/base units) */
  private toRawAmount(humanAmount: string, decimals: number): bigint {
    return BigInt(Math.round(parseFloat(humanAmount) * 10 ** decimals));
  }

  /** Fetch token decimals from chain. Native SOL = 9, SPL = read from mint account byte 44. */
  private async fetchDecimals(token: string): Promise<number> {
    if (token === NATIVE_TOKEN) return 9;
    const mintInfo = await this.connection.getAccountInfo(new PublicKey(token));
    if (!mintInfo) {
      throw new BadRequestException(`Mint account not found on-chain: ${token}`);
    }
    // SPL Token Mint layout: mintAuthority(36) + supply(8) + decimals(1) = byte 44
    return mintInfo.data[44];
  }

  /** Find faucet config by token, with WSOL <-> native fallback */
  private async findConfigByToken(token: string, enabledOnly = true): Promise<FaucetConfigEntity | null> {
    const where: Record<string, any> = enabledOnly ? { enabled: true } : {};
    let config = await this.configRepo.findOne({ where: { token, ...where } });
    if (!config && token === WSOL_MINT) {
      config = await this.configRepo.findOne({ where: { token: NATIVE_TOKEN, ...where } });
    }
    if (!config && token === NATIVE_TOKEN) {
      config = await this.configRepo.findOne({ where: { token: WSOL_MINT, ...where } });
    }
    return config;
  }

  async getAllConfigs(): Promise<FaucetConfigEntity[]> {
    return this.configRepo.find({ order: { createdAt: 'DESC' } });
  }

  async createConfig(dto: CreateFaucetConfigDto): Promise<FaucetConfigEntity> {
    const exists = await this.configRepo.findOne({ where: { token: dto.token } });
    if (exists) {
      throw new ConflictException(`Faucet config for token "${dto.token}" already exists`);
    }
    const decimals = await this.fetchDecimals(dto.token);
    const config = this.configRepo.create({
      token: dto.token,
      label: dto.label || null,
      decimals,
      amountPerRequest: dto.amountPerRequest,
      maxRequestsPerDay: dto.maxRequestsPerDay,
      maxDailyAmount: dto.maxDailyAmount || null,
      totalAmountSharable: dto.totalAmountSharable || null,
      enabled: dto.enabled ?? true,
    });
    return this.configRepo.save(config);
  }

  async updateConfig(id: string, dto: UpdateFaucetConfigDto): Promise<FaucetConfigEntity> {
    const config = await this.configRepo.findOne({ where: { id } });
    if (!config) throw new NotFoundException('Faucet config not found');

    if (dto.label !== undefined) config.label = dto.label || null;
    if (dto.amountPerRequest !== undefined) config.amountPerRequest = dto.amountPerRequest;
    if (dto.maxRequestsPerDay !== undefined) config.maxRequestsPerDay = dto.maxRequestsPerDay;
    if (dto.maxDailyAmount !== undefined) config.maxDailyAmount = dto.maxDailyAmount || null;
    if (dto.totalAmountSharable !== undefined) config.totalAmountSharable = dto.totalAmountSharable || null;
    if (dto.enabled !== undefined) config.enabled = dto.enabled;

    return this.configRepo.save(config);
  }

  async deleteConfig(id: string): Promise<void> {
    const config = await this.configRepo.findOne({ where: { id } });
    if (!config) throw new NotFoundException('Faucet config not found');
    await this.configRepo.remove(config);
  }

  // ── Availability check (shared by getStatus & claim) ──────────

  /**
   * Check all three availability conditions for a user + config:
   *   1) user daily requests < maxRequestsPerDay
   *   2) daily total shared (raw) + amountPerRequest <= maxDailyAmount (if set)
   *   3) lifetime total shared (raw) + amountPerRequest <= totalAmountSharable (if set)
   */
  private async checkAvailability(
    userAddress: string,
    config: FaucetConfigEntity,
  ): Promise<{ available: boolean; remainingClaims: number; reason?: string }> {
    // 1. User daily request count
    const remainingClaims = await this.getRemainingClaims(userAddress, config);
    if (remainingClaims <= 0) {
      return { available: false, remainingClaims: 0, reason: 'Daily claim limit reached' };
    }

    const rawAmount = this.toRawAmount(config.amountPerRequest, config.decimals);

    // 2. Global daily amount cap
    if (config.maxDailyAmount) {
      const dailyTotal = await this.getDailyTotal(config.id);
      const rawDailyLimit = this.toRawAmount(config.maxDailyAmount, config.decimals);
      if (BigInt(dailyTotal) + rawAmount > rawDailyLimit) {
        return { available: false, remainingClaims: 0, reason: 'Daily distribution cap reached' };
      }
    }

    // 3. Lifetime total cap
    if (config.totalAmountSharable) {
      const lifetimeTotal = await this.getLifetimeTotal(config.id);
      const rawLifetimeLimit = this.toRawAmount(config.totalAmountSharable, config.decimals);
      if (BigInt(lifetimeTotal) + rawAmount > rawLifetimeLimit) {
        return { available: false, remainingClaims: 0, reason: 'Lifetime distribution cap reached' };
      }
    }

    return { available: true, remainingClaims };
  }

  // ── Status check ────────────────────────────────────────────────

  async getStatus(userAddress: string, token: string): Promise<{
    available: boolean;
    remainingClaims: number;
    amountPerRequest: string;
    label: string;
    reason?: string;
  }> {
    if (!this.faucetKeypair) {
      return { available: false, remainingClaims: 0, amountPerRequest: '0', label: '', reason: 'Faucet service unavailable' };
    }

    const config = await this.findConfigByToken(token);
    if (!config) {
      return { available: false, remainingClaims: 0, amountPerRequest: '0', label: '', reason: 'Faucet not configured for this token' };
    }

    const { available, remainingClaims, reason } = await this.checkAvailability(userAddress, config);

    return {
      available,
      remainingClaims,
      amountPerRequest: config.amountPerRequest,
      label: this.resolveLabel(config),
      ...(reason ? { reason } : {}),
    };
  }

  /** Get status for all enabled tokens at once */
  async getAllStatuses(userAddress: string): Promise<Array<{
    token: string;
    label: string;
    available: boolean;
    remainingClaims: number;
    amountPerRequest: string;
    reason?: string;
  }>> {
    if (!this.faucetKeypair) return [];

    const configs = await this.configRepo.find({ where: { enabled: true } });
    if (configs.length === 0) return [];

    const results = await Promise.all(
      configs.map(async (config) => {
        const { available, remainingClaims, reason } = await this.checkAvailability(userAddress, config);
        return {
          token: config.token,
          label: this.resolveLabel(config),
          available,
          remainingClaims,
          amountPerRequest: config.amountPerRequest,
          ...(reason ? { reason } : {}),
        };
      }),
    );

    return results;
  }

  // ── Admin overview ──────────────────────────────────────────────

  /** Get comprehensive status for all faucet configs (admin use) */
  async getAdminOverview(): Promise<Array<{
    id: string;
    token: string;
    label: string;
    decimals: number;
    amountPerRequest: string;
    maxRequestsPerDay: number;
    maxDailyAmount: string | null;
    totalAmountSharable: string | null;
    enabled: boolean;
    walletBalance: string | null;
    dailyDistributed: string;
    lifetimeDistributed: string;
    uniqueUsersToday: number;
    totalClaimsToday: number;
    operational: boolean;
    operationalReason?: string;
  }>> {
    const configs = await this.configRepo.find({ order: { createdAt: 'DESC' } });
    if (configs.length === 0) return [];

    const keypair = this.faucetKeypair;

    const results = await Promise.all(
      configs.map(async (config) => {
        const label = this.resolveLabel(config);

        // Daily / lifetime distributed amounts (human-readable)
        const [dailyRaw, lifetimeRaw] = await Promise.all([
          this.getDailyTotal(config.id),
          this.getLifetimeTotal(config.id),
        ]);
        const decimals = config.decimals;
        const dailyDistributed = (Number(dailyRaw) / 10 ** decimals).toString();
        const lifetimeDistributed = (Number(lifetimeRaw) / 10 ** decimals).toString();

        // Unique users & total claims today
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const [uniqueUsersToday, totalClaimsToday] = await Promise.all([
          this.historyRepo
            .createQueryBuilder('h')
            .select('COUNT(DISTINCT h.receiver)', 'count')
            .where('h.config_id = :configId', { configId: config.id })
            .andWhere('h.status = :status', { status: 'success' })
            .andWhere('h.created_at >= :startOfDay', { startOfDay })
            .getRawOne()
            .then((r) => Number(r?.count ?? 0)),
          this.historyRepo.count({
            where: {
              configId: config.id,
              status: 'success',
              createdAt: MoreThanOrEqual(startOfDay),
            },
          }),
        ]);

        // Wallet balance
        let walletBalance: string | null = null;
        let operational = !!keypair && config.enabled;
        let operationalReason: string | undefined;

        if (!keypair) {
          operationalReason = 'Faucet keypair not configured';
          operational = false;
        } else if (!config.enabled) {
          operationalReason = 'Config disabled';
          operational = false;
        } else {
          try {
            if (config.token === NATIVE_TOKEN) {
              const bal = await this.connection.getBalance(keypair.publicKey);
              walletBalance = (bal / 10 ** 9).toString();
              if (bal < this.toRawAmount(config.amountPerRequest, decimals) + BigInt(5000)) {
                operational = false;
                operationalReason = 'Insufficient SOL balance';
              }
            } else {
              const ata = this.getAssociatedTokenAddress(new PublicKey(config.token), keypair.publicKey);
              const info = await this.connection.getAccountInfo(ata);
              if (!info) {
                walletBalance = '0';
                operational = false;
                operationalReason = 'No token account in faucet wallet';
              } else {
                const raw = info.data.readBigUInt64LE(64);
                walletBalance = (Number(raw) / 10 ** decimals).toString();
                if (raw < this.toRawAmount(config.amountPerRequest, decimals)) {
                  operational = false;
                  operationalReason = 'Insufficient token balance';
                }
              }
            }
          } catch {
            walletBalance = null;
            operational = false;
            operationalReason = 'Failed to fetch wallet balance';
          }
        }

        return {
          id: config.id,
          token: config.token,
          label,
          decimals: config.decimals,
          amountPerRequest: config.amountPerRequest,
          maxRequestsPerDay: config.maxRequestsPerDay,
          maxDailyAmount: config.maxDailyAmount,
          totalAmountSharable: config.totalAmountSharable,
          enabled: config.enabled,
          walletBalance,
          dailyDistributed,
          lifetimeDistributed,
          uniqueUsersToday,
          totalClaimsToday,
          operational,
          ...(operationalReason ? { operationalReason } : {}),
        };
      }),
    );

    return results;
  }

  // ── Claim ───────────────────────────────────────────────────────

  async claim(userAddress: string, token: string): Promise<{ txSignature: string; amount: string }> {
    const keypair = this.ensureKeypair();

    const config = await this.findConfigByToken(token);
    if (!config) {
      throw new BadRequestException('Faucet not available for you right now!');
    }

    // Re-validate all conditions (user requests, daily cap, lifetime cap)
    const { available } = await this.checkAvailability(userAddress, config);
    if (!available) {
      throw new BadRequestException('Faucet not available for you right now!');
    }

    const rawAmount = this.toRawAmount(config.amountPerRequest, config.decimals);
    const rawAmountStr = rawAmount.toString();
    const isNative = config.token === NATIVE_TOKEN;

    // Pre-check faucet wallet balance before attempting transfer
    try {
      if (isNative) {
        const balance = await this.connection.getBalance(keypair.publicKey);
        if (BigInt(balance) < rawAmount + BigInt(5000)) {
          this.logger.error(
            `Faucet wallet has insufficient SOL: balance=${balance}, needed=${rawAmount + BigInt(5000)}`,
          );
          throw new ServiceUnavailableException('Faucet service not available right now');
        }
      } else {
        const sourceAta = this.getAssociatedTokenAddress(new PublicKey(config.token), keypair.publicKey);
        const sourceInfo = await this.connection.getAccountInfo(sourceAta);
        if (!sourceInfo) {
          this.logger.error(
            `Faucet wallet has no token account for mint ${config.token}`,
          );
          throw new ServiceUnavailableException('Faucet service not available right now');
        }
        const currentBalance = sourceInfo.data.readBigUInt64LE(64);
        if (currentBalance < rawAmount) {
          this.logger.error(
            `Faucet wallet has insufficient token balance for mint ${config.token}: balance=${currentBalance}, needed=${rawAmount}`,
          );
          throw new ServiceUnavailableException('Faucet service not available right now');
        }
      }
    } catch (err) {
      // Re-throw ServiceUnavailableException as-is
      if (err instanceof ServiceUnavailableException) throw err;
      this.logger.error(`Failed to check faucet wallet balance: ${err}`);
      throw new ServiceUnavailableException('Faucet service not available right now');
    }

    // Execute transfer
    let txSignature: string;
    try {
      if (isNative) {
        txSignature = await this.transferNative(keypair, userAddress, rawAmount);
      } else {
        txSignature = await this.transferSpl(keypair, userAddress, config.token, rawAmount);
      }
    } catch (err: any) {
      this.logger.error(`Faucet transfer failed: ${err.message}`, err.stack);
      await this.historyRepo.save(
        this.historyRepo.create({
          receiver: userAddress,
          configId: config.id,
          amount: rawAmountStr,
          txSignature: 'failed',
          status: 'failed',
        }),
      );
      throw new ServiceUnavailableException('Faucet service not available right now');
    }

    // Send supporting SOL for transaction fees (best-effort, non-blocking).
    // Skipped for native SOL claims (user already receives SOL).
    // Failures here do NOT fail the claim — the main token was already sent.
    if (this.supportingSolLamports > 0n && !isNative) {
      try {
        const solBalance = await this.connection.getBalance(keypair.publicKey);
        if (BigInt(solBalance) >= this.supportingSolLamports + 5000n) {
          const solSig = await this.transferNative(keypair, userAddress, this.supportingSolLamports);
          this.logger.log(
            `Supporting SOL sent: ${Number(this.supportingSolLamports) / 1e9} SOL → ${userAddress} (tx: ${solSig})`,
          );
        } else {
          this.logger.warn(
            `Faucet wallet has insufficient SOL for supporting transfer (balance=${solBalance}, needed=${this.supportingSolLamports + 5000n})`,
          );
        }
      } catch (err: any) {
        this.logger.warn(`Supporting SOL transfer failed (non-fatal): ${err.message}`);
      }
    }

    // Record success (history stores raw amount for chain accountability)
    await this.historyRepo.save(
      this.historyRepo.create({
        receiver: userAddress,
        configId: config.id,
        amount: rawAmountStr,
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
