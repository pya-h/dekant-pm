import {
  PublicKey,
  SystemProgram,
  Keypair,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import type { DekantPm } from "./program/dekant_pm";
import {
  deriveProtocolConfig,
  deriveUserRole,
  deriveMarket,
  deriveVaultAuthority,
  deriveLpPosition,
} from "./solana";
import { Role } from "./types";

// ---------------------------------------------------------------------------
// Token program constants (duplicated from transactions.ts — private there)
// ---------------------------------------------------------------------------

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

function getAta(mint: PublicKey, owner: PublicKey): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return address;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the authority's Admin role PDA if not superadmin, or null if superadmin. */
function resolveAuthorityRole(
  authority: PublicKey,
  isSuperadmin: boolean,
): PublicKey | null {
  if (isSuperadmin) return null;
  const [pda] = deriveUserRole(authority, Role.Admin);
  return pda;
}

// ---------------------------------------------------------------------------
// Role management
// ---------------------------------------------------------------------------

export async function executeAssignRole(
  program: Program<DekantPm>,
  authority: PublicKey,
  targetUser: PublicKey,
  role: number,
  isSuperadmin: boolean,
): Promise<string> {
  const [protocolConfig] = deriveProtocolConfig();
  const [userRole] = deriveUserRole(targetUser, role);
  const authorityRole = resolveAuthorityRole(authority, isSuperadmin);

  return program.methods
    .assignRole({ role })
    .accountsPartial({
      authority,
      protocolConfig,
      authorityRole,
      targetUser,
      userRole,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function executeRevokeRole(
  program: Program<DekantPm>,
  authority: PublicKey,
  targetUser: PublicKey,
  role: number,
  isSuperadmin: boolean,
): Promise<string> {
  const [protocolConfig] = deriveProtocolConfig();
  const [userRole] = deriveUserRole(targetUser, role);
  const authorityRole = resolveAuthorityRole(authority, isSuperadmin);

  return program.methods
    .revokeRole({ role })
    .accountsPartial({
      authority,
      protocolConfig,
      authorityRole,
      targetUser,
      userRole,
    })
    .rpc();
}

// ---------------------------------------------------------------------------
// Fee management (superadmin only)
// ---------------------------------------------------------------------------

export async function executeUpdateFees(
  program: Program<DekantPm>,
  authority: PublicKey,
  fees: {
    creationFeeBps: number;
    tradeFeeBps: number;
    redemptionFeeBps: number;
    lpFeeShareBps: number;
  },
): Promise<string> {
  const [protocolConfig] = deriveProtocolConfig();

  return program.methods
    .updateFees(fees)
    .accountsPartial({
      authority,
      protocolConfig,
    })
    .rpc();
}

// ---------------------------------------------------------------------------
// Market controls
// ---------------------------------------------------------------------------

export async function executePauseMarket(
  program: Program<DekantPm>,
  authority: PublicKey,
  marketPubkey: PublicKey,
  isSuperadmin: boolean,
): Promise<string> {
  const [protocolConfig] = deriveProtocolConfig();
  const authorityRole = resolveAuthorityRole(authority, isSuperadmin);

  return program.methods
    .pauseMarket()
    .accountsPartial({
      authority,
      protocolConfig,
      authorityRole,
      market: marketPubkey,
    })
    .rpc();
}

export async function executeUnpauseMarket(
  program: Program<DekantPm>,
  authority: PublicKey,
  marketPubkey: PublicKey,
  isSuperadmin: boolean,
): Promise<string> {
  const [protocolConfig] = deriveProtocolConfig();
  const authorityRole = resolveAuthorityRole(authority, isSuperadmin);

  return program.methods
    .unpauseMarket()
    .accountsPartial({
      authority,
      protocolConfig,
      authorityRole,
      market: marketPubkey,
    })
    .rpc();
}

// ---------------------------------------------------------------------------
// Fee collection (permissionless — anyone can call, fees go to treasury)
// ---------------------------------------------------------------------------

/**
 * Build a CreateAssociatedTokenAccountIdempotent instruction.
 * Uses instruction index 1 (idempotent variant — no-op if ATA already exists).
 */
function createAtaIdempotentIx(
  payer: PublicKey,
  ata: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

export async function executeCollectFees(
  program: Program<DekantPm>,
  payer: PublicKey,
  marketPubkey: PublicKey,
): Promise<string> {
  const [protocolConfig] = deriveProtocolConfig();
  const [vaultAuthority] = deriveVaultAuthority(marketPubkey);

  // Fetch on-chain market to get vault and collateralMint
  const marketAccount = await program.account.market.fetch(marketPubkey);
  const vault = marketAccount.vault as PublicKey;
  const collateralMint = marketAccount.collateralMint as PublicKey;

  // Fetch protocol config to get treasury wallet
  const config = await program.account.protocolConfig.fetch(protocolConfig);
  const treasury = config.treasury as PublicKey;
  const treasuryAta = getAta(collateralMint, treasury);

  // Build the collect_fees instruction
  const collectIx = await program.methods
    .collectFees()
    .accountsPartial({
      payer,
      protocolConfig,
      market: marketPubkey,
      vaultAuthority,
      vault,
      treasuryAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  const tx = new Transaction();

  // If the treasury ATA doesn't exist yet, create it in the same transaction.
  // This is the most common cause of collect_fees failure on first use.
  const connection = program.provider.connection;
  const ataInfo = await connection.getAccountInfo(treasuryAta);
  if (!ataInfo) {
    tx.add(createAtaIdempotentIx(payer, treasuryAta, treasury, collateralMint));
  }

  tx.add(collectIx);

  const provider = program.provider as AnchorProvider;
  return provider.sendAndConfirm(tx, []);
}

// ---------------------------------------------------------------------------
// Market creation
// ---------------------------------------------------------------------------

/**
 * Resolve the creator's role PDA for createMarket.
 * Superadmin → null, Admin → Admin PDA, Creator → Creator PDA.
 */
function resolveCreatorRole(
  creator: PublicKey,
  isSuperadmin: boolean,
  isAdmin: boolean,
): PublicKey | null {
  if (isSuperadmin) return null;
  if (isAdmin) {
    const [pda] = deriveUserRole(creator, Role.Admin);
    return pda;
  }
  const [pda] = deriveUserRole(creator, Role.Creator);
  return pda;
}

export interface CreateMarketParams {
  marketType: number;
  numOutcomes: number;
  deadline: number; // Unix timestamp (seconds)
  oracle: PublicKey;
  collateralMint: PublicKey;
  initialLiquidity: BN; // Token base units
  rangeMin: BN; // SCALE-denominated for continuous, BN(0) for discrete
  rangeMax: BN;
  isSuperadmin: boolean;
  isAdmin: boolean;
}

export interface CreateMarketResult {
  signature: string;
  marketId: number;
  marketPubkey: PublicKey;
}

export async function executeCreateMarket(
  program: Program<DekantPm>,
  creator: PublicKey,
  params: CreateMarketParams,
): Promise<CreateMarketResult> {
  const [protocolConfig] = deriveProtocolConfig();

  // Fetch current market count to derive the new market PDA
  const config = await program.account.protocolConfig.fetch(protocolConfig);
  const marketId = (config.marketCount as BN).toNumber();
  const [marketPda] = deriveMarket(marketId);
  const [vaultAuthority] = deriveVaultAuthority(marketPda);

  // Vault must be a new keypair (signer for token account init)
  const vaultKp = Keypair.generate();

  // Derive remaining PDAs
  const creatorRole = resolveCreatorRole(
    creator,
    params.isSuperadmin,
    params.isAdmin,
  );
  const [oracleRolePda] = deriveUserRole(params.oracle, Role.Oracle);
  const [creatorLpPos] = deriveLpPosition(marketPda, creator);
  const creatorAta = getAta(params.collateralMint, creator);

  const signature = await program.methods
    .createMarket({
      marketType: params.marketType,
      numOutcomes: params.numOutcomes,
      deadline: new BN(params.deadline),
      oracle: params.oracle,
      initialLiquidity: params.initialLiquidity,
      rangeMin: params.rangeMin,
      rangeMax: params.rangeMax,
    })
    .accountsPartial({
      creator,
      creatorRole,
      protocolConfig,
      oracleRole: oracleRolePda,
      market: marketPda,
      collateralMint: params.collateralMint,
      vaultAuthority,
      vault: vaultKp.publicKey,
      creatorAta,
      creatorLpPosition: creatorLpPos,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([vaultKp])
    .rpc();

  return { signature, marketId, marketPubkey: marketPda };
}
