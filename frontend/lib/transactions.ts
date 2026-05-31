import { PublicKey, SystemProgram, ComputeBudgetProgram } from "@solana/web3.js";
import { Program, BN } from "@coral-xyz/anchor";
import type { DekantPm } from "./program/dekant_pm";
import {
  deriveProtocolConfig,
  deriveUserPosition,
  deriveLpPosition,
  deriveVaultAuthority,
} from "./solana";
import { USDC_DECIMALS, SCALE } from "./types";
import { AnchorProvider } from "@coral-xyz/anchor";
import { reportClientError, extractTxLogs } from "./report-error";

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

/**
 * Send a transaction robustly: build instruction(s), fetch a FRESH blockhash
 * right before sending (so wallet signing delay doesn't expire it), then send
 * with skipPreflight + retries.
 */
async function sendRobust(
  program: Program<DekantPm>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  builder: { preInstructions: (ixs: any[]) => any; transaction: () => Promise<any> },
  preIxs: ReturnType<typeof ComputeBudgetProgram.setComputeUnitLimit>[] = [],
  txLabel: string = "tx",
): Promise<string> {
  const provider = program.provider as AnchorProvider;
  const connection = provider.connection;
  const wallet = provider.wallet;
  let signature: string | undefined;

  // Pre-flight SOL balance check — with skipPreflight:true the RPC won't
  // simulate, so insufficient SOL manifests as a silent drop followed by a
  // confusing "transaction expired" timeout instead of a clear error.
  const solBalance = await connection.getBalance(wallet.publicKey);
  if (solBalance < 5_000) {
    throw new Error(
      "Insufficient SOL for transaction fees. Please add SOL to your wallet.",
    );
  }

  // Build the transaction via Anchor (applies accountsPartial, args, etc.)
  // Priority fee (1 micro-lamport per CU) improves tx landing on devnet.
  const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 });
  const allPreIxs = [priorityFeeIx, ...preIxs];
  const tx = await builder.preInstructions(allPreIxs).transaction();

  // Fetch a FRESH blockhash right before signing — this is the key fix.
  // Anchor's .rpc() fetches the blockhash early, then the wallet signing
  // can take 10-30+ seconds (especially on mobile), causing the blockhash
  // to expire before the tx reaches the network.
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = wallet.publicKey;

  const signed = await wallet.signTransaction(tx);

  try {
    signature = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });

    const confirmation = await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed",
    );

    // confirmTransaction does NOT throw when a tx lands and reverts on-chain —
    // it returns the on-chain err in `value.err`. Without this check, callers
    // would treat a failed tx as success.
    if (confirmation.value.err) {
      let logs: string[] = [];
      try {
        const txInfo = await connection.getTransaction(signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        logs = txInfo?.meta?.logMessages ?? [];
      } catch {
        // Best-effort log fetch; fall through with whatever we have.
      }
      const onChainErr: Error & { logs?: string[]; signature?: string } =
        new Error(
          `Transaction failed on-chain: ${JSON.stringify(confirmation.value.err)}`,
        );
      onChainErr.logs = logs;
      onChainErr.signature = signature;
      throw onChainErr;
    }

    return signature;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    reportClientError({
      event: "tx_failed",
      message: `${txLabel}: ${message}`,
      context: {
        txLabel,
        signature,
        wallet: wallet.publicKey.toBase58(),
        programId: program.programId.toBase58(),
        programLogs: extractTxLogs(err),
      },
    });
    throw err;
  }
}

/** Derive Associated Token Address (mirrors @solana/spl-token). */
function getAta(mint: PublicKey, owner: PublicKey): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return address;
}

/** Human-readable amount → token base units (6 decimals for USDC).
 *  Uses string-based parsing to avoid floating-point truncation. */
function toBaseUnits(amount: string): BN {
  const trimmed = amount.trim();
  const [whole = "0", frac = ""] = trimmed.split(".");
  const padded = (frac + "000000").slice(0, USDC_DECIMALS);
  return new BN(whole + padded);
}

/** Human-readable value → SCALE-denominated BN (for distribution mu/sigma). */
function toScaled(value: number): BN {
  return new BN(Math.round(value * SCALE));
}

/** Resolve the common set of accounts needed for all trading instructions. */
async function resolveAccounts(
  program: Program<DekantPm>,
  marketPubkey: PublicKey,
  trader: PublicKey,
) {
  const marketAccount = await program.account.market.fetch(marketPubkey);

  const [protocolConfig] = deriveProtocolConfig();
  const [userPosition] = deriveUserPosition(marketPubkey, trader);
  const [vaultAuthority] = deriveVaultAuthority(marketPubkey);
  const traderAta = getAta(marketAccount.collateralMint, trader);

  return {
    trader,
    market: marketPubkey,
    protocolConfig,
    userPosition,
    vaultAuthority,
    vault: marketAccount.vault as PublicKey,
    traderAta,
    tokenProgram: TOKEN_PROGRAM_ID,
  };
}

/** Buy discrete outcome tokens (Binary / MultiOutcome markets). */
export async function executeBuy(
  program: Program<DekantPm>,
  marketPubkey: PublicKey,
  trader: PublicKey,
  outcome: number,
  amount: string,
): Promise<string> {
  const accounts = await resolveAccounts(program, marketPubkey, trader);
  return sendRobust(
    program,
    program.methods
      .buy({ outcome, collateralAmount: toBaseUnits(amount) })
      .accountsPartial({ ...accounts, systemProgram: SystemProgram.programId }),
    [],
    "buy",
  );
}

/** Sell discrete outcome tokens (Binary / MultiOutcome markets). */
export async function executeSell(
  program: Program<DekantPm>,
  marketPubkey: PublicKey,
  trader: PublicKey,
  outcome: number,
  amount: string,
): Promise<string> {
  const accounts = await resolveAccounts(program, marketPubkey, trader);
  return sendRobust(
    program,
    program.methods
      .sell({ outcome, tokenAmount: toBaseUnits(amount) })
      .accountsPartial(accounts),
    [],
    "sell",
  );
}

/** Buy distribution position (Continuous markets). */
export async function executeBuyDistribution(
  program: Program<DekantPm>,
  marketPubkey: PublicKey,
  trader: PublicKey,
  mu: number,
  sigma: number,
  amount: string,
): Promise<string> {
  const accounts = await resolveAccounts(program, marketPubkey, trader);
  return sendRobust(
    program,
    program.methods
      .buyDistribution({
        mu: toScaled(mu),
        sigma: toScaled(sigma),
        collateralAmount: toBaseUnits(amount),
      })
      .accountsPartial({ ...accounts, systemProgram: SystemProgram.programId }),
    [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })],
    "buyDistribution",
  );
}

/** Claim payout from a resolved market. */
export async function executeClaimPayout(
  program: Program<DekantPm>,
  marketPubkey: PublicKey,
  trader: PublicKey,
): Promise<string> {
  const accounts = await resolveAccounts(program, marketPubkey, trader);
  return sendRobust(
    program,
    program.methods.claimPayout().accountsPartial(accounts),
    [],
    "claimPayout",
  );
}

/** Resolve a market (Oracle only). */
export async function executeResolveMarket(
  program: Program<DekantPm>,
  marketPubkey: PublicKey,
  oracle: PublicKey,
  outcome: number,
  value: BN,
): Promise<string> {
  return sendRobust(
    program,
    program.methods
      .resolveMarket({ outcome, value })
      .accountsPartial({ oracle, market: marketPubkey }),
    [],
    "resolveMarket",
  );
}

/** Buy outcome tokens to reach a target probability (Binary / MultiOutcome). */
export async function executeBuyToPrice(
  program: Program<DekantPm>,
  marketPubkey: PublicKey,
  trader: PublicKey,
  outcome: number,
  targetProbability: BN,
  maxCollateral: BN,
): Promise<string> {
  const accounts = await resolveAccounts(program, marketPubkey, trader);
  return sendRobust(
    program,
    program.methods
      .buyToPrice({ outcome, targetProbability, maxCollateral })
      .accountsPartial({ ...accounts, systemProgram: SystemProgram.programId }),
    [],
    "buyToPrice",
  );
}

/** Sell outcome tokens to reach a target probability (Binary / MultiOutcome). */
export async function executeSellToPrice(
  program: Program<DekantPm>,
  marketPubkey: PublicKey,
  trader: PublicKey,
  outcome: number,
  targetProbability: BN,
  minCollateralOut: BN,
): Promise<string> {
  const accounts = await resolveAccounts(program, marketPubkey, trader);
  return sendRobust(
    program,
    program.methods
      .sellToPrice({ outcome, targetProbability, minCollateralOut })
      .accountsPartial(accounts),
    [],
    "sellToPrice",
  );
}

/** Resolve accounts for LP instructions (different from trading accounts). */
async function resolveLpAccounts(
  program: Program<DekantPm>,
  marketPubkey: PublicKey,
  provider: PublicKey,
) {
  const marketAccount = await program.account.market.fetch(marketPubkey);
  const [lpPosition] = deriveLpPosition(marketPubkey, provider);
  const [vaultAuthority] = deriveVaultAuthority(marketPubkey);
  const providerAta = getAta(marketAccount.collateralMint, provider);

  return {
    provider,
    market: marketPubkey,
    lpPosition,
    vaultAuthority,
    vault: marketAccount.vault as PublicKey,
    providerAta,
    tokenProgram: TOKEN_PROGRAM_ID,
  };
}

/** Add liquidity to a market (deposit USDC, receive LP shares). */
export async function executeAddLiquidity(
  program: Program<DekantPm>,
  marketPubkey: PublicKey,
  provider: PublicKey,
  amount: string,
): Promise<string> {
  const accounts = await resolveLpAccounts(program, marketPubkey, provider);
  return sendRobust(
    program,
    program.methods
      .addLiquidity({ amount: toBaseUnits(amount) })
      .accountsPartial({ ...accounts, systemProgram: SystemProgram.programId }),
    [],
    "addLiquidity",
  );
}

/** Remove liquidity from a market (burn LP shares, receive USDC). */
export async function executeRemoveLiquidity(
  program: Program<DekantPm>,
  marketPubkey: PublicKey,
  provider: PublicKey,
  sharesToBurn: BN,
): Promise<string> {
  const accounts = await resolveLpAccounts(program, marketPubkey, provider);
  return sendRobust(
    program,
    program.methods
      .removeLiquidity({ sharesToBurn })
      .accountsPartial(accounts),
    [],
    "removeLiquidity",
  );
}

/** Sell distribution position (Continuous markets). */
export async function executeSellDistribution(
  program: Program<DekantPm>,
  marketPubkey: PublicKey,
  trader: PublicKey,
  mu: number,
  sigma: number,
  amount: string,
): Promise<string> {
  const accounts = await resolveAccounts(program, marketPubkey, trader);
  return sendRobust(
    program,
    program.methods
      .sellDistribution({
        mu: toScaled(mu),
        sigma: toScaled(sigma),
        tokenAmount: toBaseUnits(amount),
      })
      .accountsPartial(accounts),
    [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })],
    "sellDistribution",
  );
}

/** Sell entire position in a continuous market. No distribution fitting needed. */
export async function executeSellAll(
  program: Program<DekantPm>,
  marketPubkey: PublicKey,
  trader: PublicKey,
  minCollateralOut: BN = new BN(0),
): Promise<string> {
  const accounts = await resolveAccounts(program, marketPubkey, trader);
  return sendRobust(
    program,
    program.methods
      .sellAll({ minCollateralOut })
      .accountsPartial(accounts),
    [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })],
    "sellAll",
  );
}
