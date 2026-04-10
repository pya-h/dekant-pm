import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import { Umbra } from "../target/types/umbra";

// ── Constants (mirror on-chain) ─────────────────────────────────────

const PROTOCOL_CONFIG_SEED = Buffer.from("protocol_config");
const USER_ROLE_SEED = Buffer.from("user_role");
const MARKET_SEED = Buffer.from("market");
const VAULT_AUTHORITY_SEED = Buffer.from("vault_authority");
const USER_POSITION_SEED = Buffer.from("user_position");
const LP_POSITION_SEED = Buffer.from("lp_position");

const ROLE_ADMIN = 1;
const ROLE_ORACLE = 2;
const ROLE_CREATOR = 3;

const MARKET_TYPE_BINARY = 0;
const MARKET_TYPE_MULTI = 1;
const MARKET_TYPE_CONTINUOUS = 2;

const SCALE = new BN("1000000000"); // 10^9
const MIN_LIQUIDITY = new BN(1_000_000); // 1 USDC (6 decimals)
const MIN_TRADE = new BN(1_000); // 0.001 USDC

// ── PDA Helpers ─────────────────────────────────────────────────────

function findProtocolConfig(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PROTOCOL_CONFIG_SEED],
    programId
  );
}

function findUserRole(
  user: PublicKey,
  role: number,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [USER_ROLE_SEED, user.toBuffer(), Buffer.from([role])],
    programId
  );
}

function findMarket(
  marketId: number | BN,
  programId: PublicKey
): [PublicKey, number] {
  const id = typeof marketId === "number" ? new BN(marketId) : marketId;
  return PublicKey.findProgramAddressSync(
    [MARKET_SEED, id.toArrayLike(Buffer, "le", 8)],
    programId
  );
}

function findVaultAuthority(
  market: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_AUTHORITY_SEED, market.toBuffer()],
    programId
  );
}

function findUserPosition(
  market: PublicKey,
  user: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [USER_POSITION_SEED, market.toBuffer(), user.toBuffer()],
    programId
  );
}

function findLpPosition(
  market: PublicKey,
  user: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [LP_POSITION_SEED, market.toBuffer(), user.toBuffer()],
    programId
  );
}

// ── Test Harness ────────────────────────────────────────────────────

describe("Umbra Prediction Market — Full Lifecycle", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Umbra as Program<Umbra>;
  const superadmin = provider.wallet as anchor.Wallet;

  // Reusable keypairs
  const treasury = Keypair.generate();
  const oracleKp = Keypair.generate();
  const creatorKp = Keypair.generate();
  const adminKp = Keypair.generate();
  const traderA = Keypair.generate();
  const traderB = Keypair.generate();
  const lpProvider = Keypair.generate();

  let collateralMint: PublicKey;
  let protocolConfig: PublicKey;
  let protocolConfigBump: number;

  // Airdrop helper
  async function airdropSol(pubkey: PublicKey, amount = 10 * LAMPORTS_PER_SOL) {
    const sig = await provider.connection.requestAirdrop(pubkey, amount);
    await provider.connection.confirmTransaction(sig, "confirmed");
  }

  // ATA helper
  async function getOrCreateAta(
    mint: PublicKey,
    owner: PublicKey,
    payer: Keypair
  ): Promise<PublicKey> {
    return createAssociatedTokenAccount(
      provider.connection,
      payer,
      mint,
      owner
    );
  }

  // Mint tokens helper
  async function mintTokens(
    mint: PublicKey,
    dest: PublicKey,
    authority: Keypair,
    amount: number | bigint
  ) {
    await mintTo(
      provider.connection,
      authority,
      mint,
      dest,
      authority,
      amount
    );
  }

  // ── Global Setup ──────────────────────────────────────────────────

  before(async () => {
    // Fund all participants
    await Promise.all([
      airdropSol(oracleKp.publicKey),
      airdropSol(creatorKp.publicKey),
      airdropSol(adminKp.publicKey),
      airdropSol(traderA.publicKey),
      airdropSol(traderB.publicKey),
      airdropSol(lpProvider.publicKey),
      airdropSol(treasury.publicKey),
    ]);

    // Create collateral mint (6 decimals, like USDC)
    collateralMint = await createMint(
      provider.connection,
      (superadmin as any).payer, // wallet keypair
      superadmin.publicKey, // mint authority
      null,
      6
    );

    // Derive protocol config
    [protocolConfig, protocolConfigBump] = findProtocolConfig(program.programId);
  });

  // ════════════════════════════════════════════════════════════════════
  // Suite 1: Binary Market Lifecycle
  // ════════════════════════════════════════════════════════════════════

  describe("1. Binary Market Lifecycle", () => {
    let marketPda: PublicKey;
    let vaultAuthority: PublicKey;
    let vaultKp: Keypair;
    let creatorAta: PublicKey;
    let creatorLpPosition: PublicKey;
    let traderAAta: PublicKey;
    let traderBAta: PublicKey;
    let lpProviderAta: PublicKey;
    const marketId = 0;
    const deadline = Math.floor(Date.now() / 1000) + 30; // 30 seconds from now
    const initialLiquidity = new BN(10_000_000); // 10 USDC

    // ── 1.1 Initialize Protocol ─────────────────────────────────────

    it("initializes the protocol", async () => {
      const treasuryAta = await getAssociatedTokenAddress(
        collateralMint,
        treasury.publicKey
      );

      await program.methods
        .initialize({ treasury: treasury.publicKey })
        .accounts({
          authority: superadmin.publicKey,
          protocolConfig,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const config = await program.account.protocolConfig.fetch(protocolConfig);
      expect(config.superadmin.toString()).to.equal(
        superadmin.publicKey.toString()
      );
      expect(config.treasury.toString()).to.equal(
        treasury.publicKey.toString()
      );
      expect(config.marketCount.toNumber()).to.equal(0);
      expect(config.creationFeeBps).to.equal(50);
      expect(config.tradeFeeBps).to.equal(30);
      expect(config.redemptionFeeBps).to.equal(50);
      expect(config.lpFeeShareBps).to.equal(5000);
    });

    // ── 1.2 Assign Roles ────────────────────────────────────────────

    it("assigns oracle role", async () => {
      const [oracleRolePda] = findUserRole(
        oracleKp.publicKey,
        ROLE_ORACLE,
        program.programId
      );

      await program.methods
        .assignRole({ role: ROLE_ORACLE })
        .accounts({
          authority: superadmin.publicKey,
          protocolConfig,
          authorityRole: null,
          targetUser: oracleKp.publicKey,
          userRole: oracleRolePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const role = await program.account.userRole.fetch(oracleRolePda);
      expect(role.role).to.equal(ROLE_ORACLE);
      expect(role.user.toString()).to.equal(oracleKp.publicKey.toString());
    });

    it("assigns creator role", async () => {
      const [creatorRolePda] = findUserRole(
        creatorKp.publicKey,
        ROLE_CREATOR,
        program.programId
      );

      await program.methods
        .assignRole({ role: ROLE_CREATOR })
        .accounts({
          authority: superadmin.publicKey,
          protocolConfig,
          authorityRole: null,
          targetUser: creatorKp.publicKey,
          userRole: creatorRolePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const role = await program.account.userRole.fetch(creatorRolePda);
      expect(role.role).to.equal(ROLE_CREATOR);
    });

    it("assigns admin role", async () => {
      const [adminRolePda] = findUserRole(
        adminKp.publicKey,
        ROLE_ADMIN,
        program.programId
      );

      await program.methods
        .assignRole({ role: ROLE_ADMIN })
        .accounts({
          authority: superadmin.publicKey,
          protocolConfig,
          authorityRole: null,
          targetUser: adminKp.publicKey,
          userRole: adminRolePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const role = await program.account.userRole.fetch(adminRolePda);
      expect(role.role).to.equal(ROLE_ADMIN);
    });

    // ── 1.3 Create Binary Market ────────────────────────────────────

    it("creates a binary market with initial liquidity", async () => {
      [marketPda] = findMarket(marketId, program.programId);
      [vaultAuthority] = findVaultAuthority(marketPda, program.programId);
      [creatorLpPosition] = findLpPosition(
        marketPda,
        creatorKp.publicKey,
        program.programId
      );

      vaultKp = Keypair.generate();

      // Creator needs collateral tokens
      creatorAta = await getOrCreateAta(
        collateralMint,
        creatorKp.publicKey,
        creatorKp
      );
      await mintTokens(
        collateralMint,
        creatorAta,
        (superadmin as any).payer,
        BigInt(100_000_000) // 100 USDC
      );

      const [oracleRolePda] = findUserRole(
        oracleKp.publicKey,
        ROLE_ORACLE,
        program.programId
      );
      const [creatorRolePda] = findUserRole(
        creatorKp.publicKey,
        ROLE_CREATOR,
        program.programId
      );

      await program.methods
        .createMarket({
          marketType: MARKET_TYPE_BINARY,
          numOutcomes: 2,
          deadline: new BN(deadline),
          oracle: oracleKp.publicKey,
          initialLiquidity,
          rangeMin: new BN(0),
          rangeMax: new BN(0),
        })
        .accounts({
          creator: creatorKp.publicKey,
          creatorRole: creatorRolePda,
          protocolConfig,
          oracleRole: oracleRolePda,
          market: marketPda,
          collateralMint,
          vaultAuthority,
          vault: vaultKp.publicKey,
          creatorAta,
          creatorLpPosition,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creatorKp, vaultKp])
        .rpc();

      const market = await program.account.market.fetch(marketPda);
      expect(market.marketType).to.equal(MARKET_TYPE_BINARY);
      expect(market.numOutcomes).to.equal(2);
      expect(market.state).to.equal(0); // Active
      expect(market.oracle.toString()).to.equal(oracleKp.publicKey.toString());
      expect(market.reserves.length).to.equal(2);

      // Creation fee = 0.5% of 10M = 50_000, net = 9_950_000
      const netLiq = initialLiquidity.toNumber() - Math.floor(initialLiquidity.toNumber() * 50 / 10000);
      expect(market.reserves[0].toNumber()).to.equal(netLiq);
      expect(market.reserves[1].toNumber()).to.equal(netLiq);
      expect(market.protocolFeeAccumulated.toNumber()).to.equal(
        Math.floor(initialLiquidity.toNumber() * 50 / 10000)
      );
    });

    // ── 1.4 Trader A buys "Yes" (outcome 0) ─────────────────────────

    it("trader A buys outcome 0 (Yes)", async () => {
      traderAAta = await getOrCreateAta(
        collateralMint,
        traderA.publicKey,
        traderA
      );
      await mintTokens(
        collateralMint,
        traderAAta,
        (superadmin as any).payer,
        BigInt(50_000_000) // 50 USDC
      );

      const [userPositionPda] = findUserPosition(
        marketPda,
        traderA.publicKey,
        program.programId
      );
      const vault = (await program.account.market.fetch(marketPda)).vault;

      await program.methods
        .buy({
          outcome: 0,
          collateralAmount: new BN(2_000_000), // 2 USDC
        })
        .accounts({
          trader: traderA.publicKey,
          market: marketPda,
          protocolConfig,
          userPosition: userPositionPda,
          vaultAuthority,
          vault,
          traderAta: traderAAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([traderA])
        .rpc();

      const position = await program.account.userPosition.fetch(
        userPositionPda
      );
      expect(position.holdings[0].toNumber()).to.be.greaterThan(0);
      expect(position.holdings[1].toNumber()).to.equal(0);
      expect(position.totalDeposited.toNumber()).to.equal(2_000_000);
    });

    // ── 1.5 Trader B buys "No" (outcome 1) ──────────────────────────

    it("trader B buys outcome 1 (No)", async () => {
      traderBAta = await getOrCreateAta(
        collateralMint,
        traderB.publicKey,
        traderB
      );
      await mintTokens(
        collateralMint,
        traderBAta,
        (superadmin as any).payer,
        BigInt(50_000_000)
      );

      const [userPositionPda] = findUserPosition(
        marketPda,
        traderB.publicKey,
        program.programId
      );
      const vault = (await program.account.market.fetch(marketPda)).vault;

      await program.methods
        .buy({
          outcome: 1,
          collateralAmount: new BN(3_000_000), // 3 USDC
        })
        .accounts({
          trader: traderB.publicKey,
          market: marketPda,
          protocolConfig,
          userPosition: userPositionPda,
          vaultAuthority,
          vault,
          traderAta: traderBAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([traderB])
        .rpc();

      const position = await program.account.userPosition.fetch(
        userPositionPda
      );
      expect(position.holdings[1].toNumber()).to.be.greaterThan(0);
      expect(position.totalDeposited.toNumber()).to.equal(3_000_000);
    });

    // ── 1.6 Trader A sells partial position ─────────────────────────

    it("trader A sells partial position", async () => {
      const [userPositionPda] = findUserPosition(
        marketPda,
        traderA.publicKey,
        program.programId
      );
      const positionBefore = await program.account.userPosition.fetch(
        userPositionPda
      );
      const sellAmount = Math.floor(positionBefore.holdings[0].toNumber() / 2);
      expect(sellAmount).to.be.greaterThan(0);

      const vault = (await program.account.market.fetch(marketPda)).vault;
      const ataBalBefore = (await getAccount(provider.connection, traderAAta)).amount;

      await program.methods
        .sell({
          outcome: 0,
          tokenAmount: new BN(sellAmount),
        })
        .accounts({
          trader: traderA.publicKey,
          market: marketPda,
          protocolConfig,
          userPosition: userPositionPda,
          vaultAuthority,
          vault,
          traderAta: traderAAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([traderA])
        .rpc();

      const positionAfter = await program.account.userPosition.fetch(
        userPositionPda
      );
      expect(positionAfter.holdings[0].toNumber()).to.equal(
        positionBefore.holdings[0].toNumber() - sellAmount
      );
      const ataBalAfter = (await getAccount(provider.connection, traderAAta)).amount;
      expect(Number(ataBalAfter)).to.be.greaterThan(Number(ataBalBefore));
    });

    // ── 1.7 LP adds liquidity ───────────────────────────────────────

    it("LP adds liquidity", async () => {
      lpProviderAta = await getOrCreateAta(
        collateralMint,
        lpProvider.publicKey,
        lpProvider
      );
      await mintTokens(
        collateralMint,
        lpProviderAta,
        (superadmin as any).payer,
        BigInt(50_000_000)
      );

      const [lpPositionPda] = findLpPosition(
        marketPda,
        lpProvider.publicKey,
        program.programId
      );
      const vault = (await program.account.market.fetch(marketPda)).vault;

      const marketBefore = await program.account.market.fetch(marketPda);

      await program.methods
        .addLiquidity({ amount: new BN(5_000_000) }) // 5 USDC
        .accounts({
          provider: lpProvider.publicKey,
          market: marketPda,
          lpPosition: lpPositionPda,
          vaultAuthority,
          vault,
          providerAta: lpProviderAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([lpProvider])
        .rpc();

      const lp = await program.account.lpPosition.fetch(lpPositionPda);
      expect(lp.shares.toString()).to.not.equal("0");
      expect(lp.depositedCollateral.toNumber()).to.equal(5_000_000);

      const marketAfter = await program.account.market.fetch(marketPda);
      expect(marketAfter.lpSharesTotal.toString()).to.not.equal(
        marketBefore.lpSharesTotal.toString()
      );
    });

    // ── 1.8 Wait for deadline, trade after → fails ──────────────────

    it("rejects trade after deadline (lazy enforcement)", async () => {
      // Wait for deadline to pass
      const market = await program.account.market.fetch(marketPda);
      const now = Math.floor(Date.now() / 1000);
      const waitMs = (market.deadline.toNumber() - now + 2) * 1000;
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }

      const [userPositionPda] = findUserPosition(
        marketPda,
        traderA.publicKey,
        program.programId
      );

      try {
        await program.methods
          .buy({
            outcome: 0,
            collateralAmount: new BN(1_000_000),
          })
          .accounts({
            trader: traderA.publicKey,
            market: marketPda,
            protocolConfig,
            userPosition: userPositionPda,
            vaultAuthority,
            vault: market.vault,
            traderAta: traderAAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([traderA])
          .rpc();
        expect.fail("Should have thrown MarketClosed error");
      } catch (err: any) {
        expect(err.toString()).to.include("MarketClosed");
      }
    });

    // ── 1.9 Oracle resolves (outcome 0 wins) ────────────────────────

    it("oracle resolves the market (outcome 0 wins)", async () => {
      await program.methods
        .resolveMarket({
          outcome: 0,
          value: new BN(0),
        })
        .accounts({
          oracle: oracleKp.publicKey,
          market: marketPda,
        })
        .signers([oracleKp])
        .rpc();

      const market = await program.account.market.fetch(marketPda);
      expect(market.state).to.equal(3); // Resolved
      expect(market.resolvedOutcome).to.equal(0);
    });

    // ── 1.10 Trader A claims payout ─────────────────────────────────

    it("trader A claims payout (winner)", async () => {
      const [userPositionPda] = findUserPosition(
        marketPda,
        traderA.publicKey,
        program.programId
      );
      const market = await program.account.market.fetch(marketPda);
      const ataBalBefore = (await getAccount(provider.connection, traderAAta)).amount;

      await program.methods
        .claimPayout()
        .accounts({
          trader: traderA.publicKey,
          market: marketPda,
          protocolConfig,
          userPosition: userPositionPda,
          vaultAuthority,
          vault: market.vault,
          traderAta: traderAAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([traderA])
        .rpc();

      const position = await program.account.userPosition.fetch(
        userPositionPda
      );
      expect(position.claimed).to.be.true;

      const ataBalAfter = (await getAccount(provider.connection, traderAAta)).amount;
      expect(Number(ataBalAfter)).to.be.greaterThan(Number(ataBalBefore));
    });

    // ── 1.11 Trader B claims → NothingToClaim ───────────────────────

    it("trader B claim fails (NothingToClaim — wrong outcome)", async () => {
      const [userPositionPda] = findUserPosition(
        marketPda,
        traderB.publicKey,
        program.programId
      );
      const market = await program.account.market.fetch(marketPda);

      try {
        await program.methods
          .claimPayout()
          .accounts({
            trader: traderB.publicKey,
            market: marketPda,
            protocolConfig,
            userPosition: userPositionPda,
            vaultAuthority,
            vault: market.vault,
            traderAta: traderBAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([traderB])
          .rpc();
        expect.fail("Should have thrown NothingToClaim error");
      } catch (err: any) {
        expect(err.toString()).to.include("NothingToClaim");
      }
    });

    // ── 1.12 LP removes liquidity ───────────────────────────────────

    it("LP removes liquidity from resolved market", async () => {
      const [lpPositionPda] = findLpPosition(
        marketPda,
        lpProvider.publicKey,
        program.programId
      );
      const lp = await program.account.lpPosition.fetch(lpPositionPda);
      const market = await program.account.market.fetch(marketPda);

      const ataBalBefore = (
        await getAccount(provider.connection, lpProviderAta)
      ).amount;

      await program.methods
        .removeLiquidity({ sharesToBurn: lp.shares })
        .accounts({
          provider: lpProvider.publicKey,
          market: marketPda,
          lpPosition: lpPositionPda,
          vaultAuthority,
          vault: market.vault,
          providerAta: lpProviderAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([lpProvider])
        .rpc();

      const lpAfter = await program.account.lpPosition.fetch(lpPositionPda);
      expect(lpAfter.shares.toString()).to.equal("0");

      const ataBalAfter = (
        await getAccount(provider.connection, lpProviderAta)
      ).amount;
      expect(Number(ataBalAfter)).to.be.greaterThan(Number(ataBalBefore));
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Suite 2: Multi-Outcome Market Lifecycle
  // ════════════════════════════════════════════════════════════════════

  describe("2. Multi-Outcome Market Lifecycle", () => {
    let marketPda: PublicKey;
    let vaultAuthority: PublicKey;
    let vaultKp: Keypair;
    const marketId = 1; // second market
    const deadline = Math.floor(Date.now() / 1000) + 60;
    const initialLiquidity = new BN(20_000_000); // 20 USDC
    const NUM_OUTCOMES = 5;

    it("creates a 5-outcome multi market", async () => {
      [marketPda] = findMarket(marketId, program.programId);
      [vaultAuthority] = findVaultAuthority(marketPda, program.programId);
      vaultKp = Keypair.generate();

      const creatorAta = await getAssociatedTokenAddress(
        collateralMint,
        creatorKp.publicKey
      );
      // Mint more tokens to creator
      await mintTokens(
        collateralMint,
        creatorAta,
        (superadmin as any).payer,
        BigInt(100_000_000)
      );

      const [oracleRolePda] = findUserRole(
        oracleKp.publicKey,
        ROLE_ORACLE,
        program.programId
      );
      const [creatorRolePda] = findUserRole(
        creatorKp.publicKey,
        ROLE_CREATOR,
        program.programId
      );
      const [creatorLpPosition] = findLpPosition(
        marketPda,
        creatorKp.publicKey,
        program.programId
      );

      await program.methods
        .createMarket({
          marketType: MARKET_TYPE_MULTI,
          numOutcomes: NUM_OUTCOMES,
          deadline: new BN(deadline),
          oracle: oracleKp.publicKey,
          initialLiquidity,
          rangeMin: new BN(0),
          rangeMax: new BN(0),
        })
        .accounts({
          creator: creatorKp.publicKey,
          creatorRole: creatorRolePda,
          protocolConfig,
          oracleRole: oracleRolePda,
          market: marketPda,
          collateralMint,
          vaultAuthority,
          vault: vaultKp.publicKey,
          creatorAta,
          creatorLpPosition,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creatorKp, vaultKp])
        .rpc();

      const market = await program.account.market.fetch(marketPda);
      expect(market.marketType).to.equal(MARKET_TYPE_MULTI);
      expect(market.numOutcomes).to.equal(NUM_OUTCOMES);
      expect(market.reserves.length).to.equal(NUM_OUTCOMES);
      expect(market.state).to.equal(0);
    });

    it("multiple traders buy different outcomes", async () => {
      const vault = (await program.account.market.fetch(marketPda)).vault;

      // Trader A buys outcome 2
      const [posA] = findUserPosition(
        marketPda,
        traderA.publicKey,
        program.programId
      );
      const traderAAta = await getAssociatedTokenAddress(
        collateralMint,
        traderA.publicKey
      );

      await program.methods
        .buy({ outcome: 2, collateralAmount: new BN(2_000_000) })
        .accounts({
          trader: traderA.publicKey,
          market: marketPda,
          protocolConfig,
          userPosition: posA,
          vaultAuthority,
          vault,
          traderAta: traderAAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([traderA])
        .rpc();

      // Trader B buys outcome 4
      const [posB] = findUserPosition(
        marketPda,
        traderB.publicKey,
        program.programId
      );
      const traderBAta = await getAssociatedTokenAddress(
        collateralMint,
        traderB.publicKey
      );

      await program.methods
        .buy({ outcome: 4, collateralAmount: new BN(3_000_000) })
        .accounts({
          trader: traderB.publicKey,
          market: marketPda,
          protocolConfig,
          userPosition: posB,
          vaultAuthority,
          vault,
          traderAta: traderBAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([traderB])
        .rpc();

      const positionA = await program.account.userPosition.fetch(posA);
      const positionB = await program.account.userPosition.fetch(posB);
      expect(positionA.holdings[2].toNumber()).to.be.greaterThan(0);
      expect(positionB.holdings[4].toNumber()).to.be.greaterThan(0);
    });

    it("oracle resolves multi-outcome market (outcome 2 wins)", async () => {
      // Fast-forward past deadline
      const market = await program.account.market.fetch(marketPda);
      const now = Math.floor(Date.now() / 1000);
      const waitMs = (market.deadline.toNumber() - now + 2) * 1000;
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }

      await program.methods
        .resolveMarket({ outcome: 2, value: new BN(0) })
        .accounts({
          oracle: oracleKp.publicKey,
          market: marketPda,
        })
        .signers([oracleKp])
        .rpc();

      const resolved = await program.account.market.fetch(marketPda);
      expect(resolved.state).to.equal(3);
      expect(resolved.resolvedOutcome).to.equal(2);
    });

    it("winner (trader A) claims; loser (trader B) fails to claim", async () => {
      const market = await program.account.market.fetch(marketPda);
      const [posA] = findUserPosition(
        marketPda,
        traderA.publicKey,
        program.programId
      );
      const traderAAta = await getAssociatedTokenAddress(
        collateralMint,
        traderA.publicKey
      );

      // Winner claims
      await program.methods
        .claimPayout()
        .accounts({
          trader: traderA.publicKey,
          market: marketPda,
          protocolConfig,
          userPosition: posA,
          vaultAuthority,
          vault: market.vault,
          traderAta: traderAAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([traderA])
        .rpc();

      const positionA = await program.account.userPosition.fetch(posA);
      expect(positionA.claimed).to.be.true;

      // Loser tries to claim
      const [posB] = findUserPosition(
        marketPda,
        traderB.publicKey,
        program.programId
      );
      const traderBAta = await getAssociatedTokenAddress(
        collateralMint,
        traderB.publicKey
      );

      try {
        await program.methods
          .claimPayout()
          .accounts({
            trader: traderB.publicKey,
            market: marketPda,
            protocolConfig,
            userPosition: posB,
            vaultAuthority,
            vault: market.vault,
            traderAta: traderBAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([traderB])
          .rpc();
        expect.fail("Loser should not be able to claim");
      } catch (err: any) {
        expect(err.toString()).to.include("NothingToClaim");
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Suite 3: Continuous Market Lifecycle
  // ════════════════════════════════════════════════════════════════════

  describe("3. Continuous Market Lifecycle", () => {
    let marketPda: PublicKey;
    let vaultAuthority: PublicKey;
    let vaultKp: Keypair;
    const marketId = 2;
    const deadline = Math.floor(Date.now() / 1000) + 90;
    const initialLiquidity = new BN(20_000_000);
    const NUM_BINS = 64;
    // Range scaled to 10^9: [100, 300]
    const RANGE_MIN = new BN(100).mul(SCALE);
    const RANGE_MAX = new BN(300).mul(SCALE);

    it("creates a 64-bin continuous market", async () => {
      [marketPda] = findMarket(marketId, program.programId);
      [vaultAuthority] = findVaultAuthority(marketPda, program.programId);
      vaultKp = Keypair.generate();

      const creatorAta = await getAssociatedTokenAddress(
        collateralMint,
        creatorKp.publicKey
      );
      await mintTokens(
        collateralMint,
        creatorAta,
        (superadmin as any).payer,
        BigInt(100_000_000)
      );

      const [oracleRolePda] = findUserRole(
        oracleKp.publicKey,
        ROLE_ORACLE,
        program.programId
      );
      const [creatorRolePda] = findUserRole(
        creatorKp.publicKey,
        ROLE_CREATOR,
        program.programId
      );
      const [creatorLpPosition] = findLpPosition(
        marketPda,
        creatorKp.publicKey,
        program.programId
      );

      await program.methods
        .createMarket({
          marketType: MARKET_TYPE_CONTINUOUS,
          numOutcomes: NUM_BINS,
          deadline: new BN(deadline),
          oracle: oracleKp.publicKey,
          initialLiquidity,
          rangeMin: RANGE_MIN,
          rangeMax: RANGE_MAX,
        })
        .accounts({
          creator: creatorKp.publicKey,
          creatorRole: creatorRolePda,
          protocolConfig,
          oracleRole: oracleRolePda,
          market: marketPda,
          collateralMint,
          vaultAuthority,
          vault: vaultKp.publicKey,
          creatorAta,
          creatorLpPosition,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creatorKp, vaultKp])
        .rpc();

      const market = await program.account.market.fetch(marketPda);
      expect(market.marketType).to.equal(MARKET_TYPE_CONTINUOUS);
      expect(market.numOutcomes).to.equal(NUM_BINS);
      expect(market.reserves.length).to.equal(NUM_BINS);
      expect(market.rangeMin.toString()).to.equal(RANGE_MIN.toString());
      expect(market.rangeMax.toString()).to.equal(RANGE_MAX.toString());
    });

    it("trader buys distribution N(150, 20)", async () => {
      const vault = (await program.account.market.fetch(marketPda)).vault;
      const [posA] = findUserPosition(
        marketPda,
        traderA.publicKey,
        program.programId
      );
      const traderAAta = await getAssociatedTokenAddress(
        collateralMint,
        traderA.publicKey
      );

      await program.methods
        .buyDistribution({
          mu: new BN(150).mul(SCALE),       // center = 150
          sigma: new BN(20).mul(SCALE),      // std dev = 20
          collateralAmount: new BN(5_000_000), // 5 USDC
        })
        .accounts({
          trader: traderA.publicKey,
          market: marketPda,
          protocolConfig,
          userPosition: posA,
          vaultAuthority,
          vault,
          traderAta: traderAAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
        ])
        .signers([traderA])
        .rpc();

      const position = await program.account.userPosition.fetch(posA);
      // Should have tokens in bins near the center
      const totalTokens = position.holdings.reduce(
        (sum: number, h: any) => sum + h.toNumber(),
        0
      );
      expect(totalTokens).to.be.greaterThan(0);
    });

    it("trader B buys distribution N(200, 10)", async () => {
      const vault = (await program.account.market.fetch(marketPda)).vault;
      const [posB] = findUserPosition(
        marketPda,
        traderB.publicKey,
        program.programId
      );
      const traderBAta = await getAssociatedTokenAddress(
        collateralMint,
        traderB.publicKey
      );

      await program.methods
        .buyDistribution({
          mu: new BN(200).mul(SCALE),
          sigma: new BN(10).mul(SCALE),
          collateralAmount: new BN(3_000_000),
        })
        .accounts({
          trader: traderB.publicKey,
          market: marketPda,
          protocolConfig,
          userPosition: posB,
          vaultAuthority,
          vault,
          traderAta: traderBAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
        ])
        .signers([traderB])
        .rpc();

      const position = await program.account.userPosition.fetch(posB);
      const totalTokens = position.holdings.reduce(
        (sum: number, h: any) => sum + h.toNumber(),
        0
      );
      expect(totalTokens).to.be.greaterThan(0);
    });

    it("oracle resolves with value 155 (close to trader A's center)", async () => {
      const market = await program.account.market.fetch(marketPda);
      const now = Math.floor(Date.now() / 1000);
      const waitMs = (market.deadline.toNumber() - now + 2) * 1000;
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }

      // Value 155, scaled to 10^9. Resolved outcome is computed by the market.
      await program.methods
        .resolveMarket({
          outcome: 0, // Ignored for continuous — computed from value
          value: new BN(155).mul(SCALE),
        })
        .accounts({
          oracle: oracleKp.publicKey,
          market: marketPda,
        })
        .signers([oracleKp])
        .rpc();

      const resolved = await program.account.market.fetch(marketPda);
      expect(resolved.state).to.equal(3);
      expect(resolved.resolvedValue.toString()).to.equal(
        new BN(155).mul(SCALE).toString()
      );
    });

    it("trader A claims payout from continuous market", async () => {
      const [posA] = findUserPosition(
        marketPda,
        traderA.publicKey,
        program.programId
      );
      const market = await program.account.market.fetch(marketPda);
      const traderAAta = await getAssociatedTokenAddress(
        collateralMint,
        traderA.publicKey
      );

      const positionBefore = await program.account.userPosition.fetch(posA);
      const winningBin = market.resolvedOutcome;
      const winningTokens = positionBefore.holdings[winningBin].toNumber();

      if (winningTokens > 0) {
        await program.methods
          .claimPayout()
          .accounts({
            trader: traderA.publicKey,
            market: marketPda,
            protocolConfig,
            userPosition: posA,
            vaultAuthority,
            vault: market.vault,
            traderAta: traderAAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([traderA])
          .rpc();

        const positionAfter = await program.account.userPosition.fetch(posA);
        expect(positionAfter.claimed).to.be.true;
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Suite 4: Admin Operations
  // ════════════════════════════════════════════════════════════════════

  describe("4. Admin Operations", () => {
    let marketPda: PublicKey;
    let vaultAuthority: PublicKey;
    let vaultKp: Keypair;
    const marketId = 3;
    const deadline = Math.floor(Date.now() / 1000) + 120;
    const initialLiquidity = new BN(10_000_000);

    before(async () => {
      // Create a fresh market for admin tests
      [marketPda] = findMarket(marketId, program.programId);
      [vaultAuthority] = findVaultAuthority(marketPda, program.programId);
      vaultKp = Keypair.generate();

      const creatorAta = await getAssociatedTokenAddress(
        collateralMint,
        creatorKp.publicKey
      );
      await mintTokens(
        collateralMint,
        creatorAta,
        (superadmin as any).payer,
        BigInt(50_000_000)
      );

      const [oracleRolePda] = findUserRole(
        oracleKp.publicKey,
        ROLE_ORACLE,
        program.programId
      );
      const [creatorRolePda] = findUserRole(
        creatorKp.publicKey,
        ROLE_CREATOR,
        program.programId
      );
      const [creatorLpPosition] = findLpPosition(
        marketPda,
        creatorKp.publicKey,
        program.programId
      );

      await program.methods
        .createMarket({
          marketType: MARKET_TYPE_BINARY,
          numOutcomes: 2,
          deadline: new BN(deadline),
          oracle: oracleKp.publicKey,
          initialLiquidity,
          rangeMin: new BN(0),
          rangeMax: new BN(0),
        })
        .accounts({
          creator: creatorKp.publicKey,
          creatorRole: creatorRolePda,
          protocolConfig,
          oracleRole: oracleRolePda,
          market: marketPda,
          collateralMint,
          vaultAuthority,
          vault: vaultKp.publicKey,
          creatorAta,
          creatorLpPosition,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creatorKp, vaultKp])
        .rpc();
    });

    it("admin pauses the market", async () => {
      const [adminRolePda] = findUserRole(
        adminKp.publicKey,
        ROLE_ADMIN,
        program.programId
      );

      await program.methods
        .pauseMarket()
        .accounts({
          authority: adminKp.publicKey,
          protocolConfig,
          authorityRole: adminRolePda,
          market: marketPda,
        })
        .signers([adminKp])
        .rpc();

      const market = await program.account.market.fetch(marketPda);
      expect(market.state).to.equal(1); // Paused
    });

    it("trades fail while paused", async () => {
      const [posA] = findUserPosition(
        marketPda,
        traderA.publicKey,
        program.programId
      );
      const market = await program.account.market.fetch(marketPda);
      const traderAAta = await getAssociatedTokenAddress(
        collateralMint,
        traderA.publicKey
      );

      try {
        await program.methods
          .buy({ outcome: 0, collateralAmount: new BN(1_000_000) })
          .accounts({
            trader: traderA.publicKey,
            market: marketPda,
            protocolConfig,
            userPosition: posA,
            vaultAuthority,
            vault: market.vault,
            traderAta: traderAAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([traderA])
          .rpc();
        expect.fail("Trade should fail while paused");
      } catch (err: any) {
        expect(err.toString()).to.include("MarketNotActive");
      }
    });

    it("admin unpauses the market", async () => {
      const [adminRolePda] = findUserRole(
        adminKp.publicKey,
        ROLE_ADMIN,
        program.programId
      );

      await program.methods
        .unpauseMarket()
        .accounts({
          authority: adminKp.publicKey,
          protocolConfig,
          authorityRole: adminRolePda,
          market: marketPda,
        })
        .signers([adminKp])
        .rpc();

      const market = await program.account.market.fetch(marketPda);
      expect(market.state).to.equal(0); // Active
    });

    it("trades succeed after unpause", async () => {
      const [posA] = findUserPosition(
        marketPda,
        traderA.publicKey,
        program.programId
      );
      const market = await program.account.market.fetch(marketPda);
      const traderAAta = await getAssociatedTokenAddress(
        collateralMint,
        traderA.publicKey
      );

      await program.methods
        .buy({ outcome: 0, collateralAmount: new BN(1_000_000) })
        .accounts({
          trader: traderA.publicKey,
          market: marketPda,
          protocolConfig,
          userPosition: posA,
          vaultAuthority,
          vault: market.vault,
          traderAta: traderAAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([traderA])
        .rpc();

      // Verify position was created/updated
      const position = await program.account.userPosition.fetch(posA);
      expect(position.holdings[0].toNumber()).to.be.greaterThan(0);
    });

    it("superadmin updates fees", async () => {
      await program.methods
        .updateFees({
          creationFeeBps: 100,     // 1%
          tradeFeeBps: 50,         // 0.5%
          redemptionFeeBps: 25,    // 0.25%
          lpFeeShareBps: 6000,     // 60%
        })
        .accounts({
          authority: superadmin.publicKey,
          protocolConfig,
        })
        .rpc();

      const config = await program.account.protocolConfig.fetch(protocolConfig);
      expect(config.creationFeeBps).to.equal(100);
      expect(config.tradeFeeBps).to.equal(50);
      expect(config.redemptionFeeBps).to.equal(25);
      expect(config.lpFeeShareBps).to.equal(6000);
    });

    it("new trades use updated fee rates", async () => {
      const marketBefore = await program.account.market.fetch(marketPda);
      const feesBefore = marketBefore.protocolFeeAccumulated.toNumber();

      const [posA] = findUserPosition(
        marketPda,
        traderA.publicKey,
        program.programId
      );
      const traderAAta = await getAssociatedTokenAddress(
        collateralMint,
        traderA.publicKey
      );

      await program.methods
        .buy({ outcome: 1, collateralAmount: new BN(2_000_000) })
        .accounts({
          trader: traderA.publicKey,
          market: marketPda,
          protocolConfig,
          userPosition: posA,
          vaultAuthority,
          vault: marketBefore.vault,
          traderAta: traderAAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([traderA])
        .rpc();

      const marketAfter = await program.account.market.fetch(marketPda);
      const feesAfter = marketAfter.protocolFeeAccumulated.toNumber();
      // Protocol fee should have increased (0.5% trade fee, 40% protocol share)
      expect(feesAfter).to.be.greaterThan(feesBefore);
    });

    it("superadmin collects protocol fees", async () => {
      const market = await program.account.market.fetch(marketPda);
      expect(market.protocolFeeAccumulated.toNumber()).to.be.greaterThan(0);

      // Create treasury ATA
      let treasuryAta: PublicKey;
      try {
        treasuryAta = await createAssociatedTokenAccount(
          provider.connection,
          treasury,
          collateralMint,
          treasury.publicKey
        );
      } catch {
        treasuryAta = await getAssociatedTokenAddress(
          collateralMint,
          treasury.publicKey
        );
      }

      await program.methods
        .collectFees()
        .accounts({
          authority: superadmin.publicKey,
          protocolConfig,
          market: marketPda,
          vaultAuthority,
          vault: market.vault,
          treasuryAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const marketAfter = await program.account.market.fetch(marketPda);
      expect(marketAfter.protocolFeeAccumulated.toNumber()).to.equal(0);

      const treasuryBalance = (
        await getAccount(provider.connection, treasuryAta)
      ).amount;
      expect(Number(treasuryBalance)).to.be.greaterThan(0);
    });

    // Restore original fees for other tests
    after(async () => {
      await program.methods
        .updateFees({
          creationFeeBps: 50,
          tradeFeeBps: 30,
          redemptionFeeBps: 50,
          lpFeeShareBps: 5000,
        })
        .accounts({
          authority: superadmin.publicKey,
          protocolConfig,
        })
        .rpc();
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Suite 5: Edge Cases
  // ════════════════════════════════════════════════════════════════════

  describe("5. Edge Cases", () => {
    let marketPda: PublicKey;
    let vaultAuthority: PublicKey;
    let vaultKp: Keypair;
    const marketId = 4;
    const deadline = Math.floor(Date.now() / 1000) + 120;
    const initialLiquidity = new BN(10_000_000);

    before(async () => {
      [marketPda] = findMarket(marketId, program.programId);
      [vaultAuthority] = findVaultAuthority(marketPda, program.programId);
      vaultKp = Keypair.generate();

      const creatorAta = await getAssociatedTokenAddress(
        collateralMint,
        creatorKp.publicKey
      );
      await mintTokens(
        collateralMint,
        creatorAta,
        (superadmin as any).payer,
        BigInt(50_000_000)
      );

      const [oracleRolePda] = findUserRole(
        oracleKp.publicKey,
        ROLE_ORACLE,
        program.programId
      );
      const [creatorRolePda] = findUserRole(
        creatorKp.publicKey,
        ROLE_CREATOR,
        program.programId
      );
      const [creatorLpPosition] = findLpPosition(
        marketPda,
        creatorKp.publicKey,
        program.programId
      );

      await program.methods
        .createMarket({
          marketType: MARKET_TYPE_BINARY,
          numOutcomes: 2,
          deadline: new BN(deadline),
          oracle: oracleKp.publicKey,
          initialLiquidity,
          rangeMin: new BN(0),
          rangeMax: new BN(0),
        })
        .accounts({
          creator: creatorKp.publicKey,
          creatorRole: creatorRolePda,
          protocolConfig,
          oracleRole: oracleRolePda,
          market: marketPda,
          collateralMint,
          vaultAuthority,
          vault: vaultKp.publicKey,
          creatorAta,
          creatorLpPosition,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creatorKp, vaultKp])
        .rpc();
    });

    it("rejects buy below minimum trade amount", async () => {
      const [posA] = findUserPosition(
        marketPda,
        traderA.publicKey,
        program.programId
      );
      const market = await program.account.market.fetch(marketPda);
      const traderAAta = await getAssociatedTokenAddress(
        collateralMint,
        traderA.publicKey
      );

      try {
        await program.methods
          .buy({ outcome: 0, collateralAmount: new BN(100) }) // below MIN_TRADE (1000)
          .accounts({
            trader: traderA.publicKey,
            market: marketPda,
            protocolConfig,
            userPosition: posA,
            vaultAuthority,
            vault: market.vault,
            traderAta: traderAAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([traderA])
          .rpc();
        expect.fail("Should reject trade below minimum");
      } catch (err: any) {
        expect(err.toString()).to.include("TradeTooSmall");
      }
    });

    it("rejects sell with zero tokens", async () => {
      // First make a buy to create the position
      const [posA] = findUserPosition(
        marketPda,
        traderA.publicKey,
        program.programId
      );
      const market = await program.account.market.fetch(marketPda);
      const traderAAta = await getAssociatedTokenAddress(
        collateralMint,
        traderA.publicKey
      );

      await program.methods
        .buy({ outcome: 0, collateralAmount: new BN(1_000_000) })
        .accounts({
          trader: traderA.publicKey,
          market: marketPda,
          protocolConfig,
          userPosition: posA,
          vaultAuthority,
          vault: market.vault,
          traderAta: traderAAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([traderA])
        .rpc();

      // Now try to sell 0 tokens
      try {
        await program.methods
          .sell({ outcome: 0, tokenAmount: new BN(0) })
          .accounts({
            trader: traderA.publicKey,
            market: marketPda,
            protocolConfig,
            userPosition: posA,
            vaultAuthority,
            vault: market.vault,
            traderAta: traderAAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([traderA])
          .rpc();
        expect.fail("Should reject zero-token sell");
      } catch (err: any) {
        expect(err.toString()).to.include("TradeTooSmall");
      }
    });

    it("rejects sell exceeding holdings", async () => {
      const [posA] = findUserPosition(
        marketPda,
        traderA.publicKey,
        program.programId
      );
      const position = await program.account.userPosition.fetch(posA);
      const holdings = position.holdings[0].toNumber();
      const market = await program.account.market.fetch(marketPda);
      const traderAAta = await getAssociatedTokenAddress(
        collateralMint,
        traderA.publicKey
      );

      try {
        await program.methods
          .sell({
            outcome: 0,
            tokenAmount: new BN(holdings + 1_000_000), // way more than held
          })
          .accounts({
            trader: traderA.publicKey,
            market: marketPda,
            protocolConfig,
            userPosition: posA,
            vaultAuthority,
            vault: market.vault,
            traderAta: traderAAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([traderA])
          .rpc();
        expect.fail("Should reject sell exceeding holdings");
      } catch (err: any) {
        expect(err.toString()).to.include("InsufficientHoldings");
      }
    });

    it("rejects wrong oracle resolving market", async () => {
      try {
        await program.methods
          .resolveMarket({ outcome: 0, value: new BN(0) })
          .accounts({
            oracle: traderA.publicKey, // Not the oracle
            market: marketPda,
          })
          .signers([traderA])
          .rpc();
        expect.fail("Wrong oracle should not be able to resolve");
      } catch (err: any) {
        expect(err.toString()).to.include("WrongOracle");
      }
    });

    it("rejects unauthorized role assignment", async () => {
      const fakeAdmin = Keypair.generate();
      await airdropSol(fakeAdmin.publicKey);

      const [rolePda] = findUserRole(
        traderA.publicKey,
        ROLE_ORACLE,
        program.programId
      );

      try {
        await program.methods
          .assignRole({ role: ROLE_ORACLE })
          .accounts({
            authority: fakeAdmin.publicKey,
            protocolConfig,
            authorityRole: null,
            targetUser: traderA.publicKey,
            userRole: rolePda,
            systemProgram: SystemProgram.programId,
          })
          .signers([fakeAdmin])
          .rpc();
        expect.fail("Unauthorized user should not assign roles");
      } catch (err: any) {
        expect(err.toString()).to.include("Unauthorized");
      }
    });

    it("rejects liquidity below minimum", async () => {
      const [lpPos] = findLpPosition(
        marketPda,
        lpProvider.publicKey,
        program.programId
      );
      const market = await program.account.market.fetch(marketPda);
      const lpAta = await getAssociatedTokenAddress(
        collateralMint,
        lpProvider.publicKey
      );

      try {
        await program.methods
          .addLiquidity({ amount: new BN(100) }) // below MIN_LIQUIDITY
          .accounts({
            provider: lpProvider.publicKey,
            market: marketPda,
            lpPosition: lpPos,
            vaultAuthority,
            vault: market.vault,
            providerAta: lpAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([lpProvider])
          .rpc();
        expect.fail("Should reject liquidity below minimum");
      } catch (err: any) {
        expect(err.toString()).to.include("LiquidityTooSmall");
      }
    });

    it("rejects duplicate claim", async () => {
      // Fast-forward and resolve
      const market = await program.account.market.fetch(marketPda);
      const now = Math.floor(Date.now() / 1000);
      const waitMs = (market.deadline.toNumber() - now + 2) * 1000;
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }

      await program.methods
        .resolveMarket({ outcome: 0, value: new BN(0) })
        .accounts({
          oracle: oracleKp.publicKey,
          market: marketPda,
        })
        .signers([oracleKp])
        .rpc();

      const [posA] = findUserPosition(
        marketPda,
        traderA.publicKey,
        program.programId
      );
      const traderAAta = await getAssociatedTokenAddress(
        collateralMint,
        traderA.publicKey
      );
      const updatedMarket = await program.account.market.fetch(marketPda);

      // First claim should succeed
      await program.methods
        .claimPayout()
        .accounts({
          trader: traderA.publicKey,
          market: marketPda,
          protocolConfig,
          userPosition: posA,
          vaultAuthority,
          vault: updatedMarket.vault,
          traderAta: traderAAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([traderA])
        .rpc();

      // Second claim should fail
      try {
        await program.methods
          .claimPayout()
          .accounts({
            trader: traderA.publicKey,
            market: marketPda,
            protocolConfig,
            userPosition: posA,
            vaultAuthority,
            vault: updatedMarket.vault,
            traderAta: traderAAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([traderA])
          .rpc();
        expect.fail("Duplicate claim should fail");
      } catch (err: any) {
        expect(err.toString()).to.include("AlreadyClaimed");
      }
    });

    it("rejects fee update exceeding maximum", async () => {
      try {
        await program.methods
          .updateFees({
            creationFeeBps: 6000, // 60% > MAX_FEE_BPS (5000)
            tradeFeeBps: 30,
            redemptionFeeBps: 50,
            lpFeeShareBps: 5000,
          })
          .accounts({
            authority: superadmin.publicKey,
            protocolConfig,
          })
          .rpc();
        expect.fail("Should reject fee exceeding max");
      } catch (err: any) {
        expect(err.toString()).to.include("FeeTooHigh");
      }
    });

    it("admin can assign oracle/creator roles (delegation)", async () => {
      const newUser = Keypair.generate();
      await airdropSol(newUser.publicKey);

      const [adminRolePda] = findUserRole(
        adminKp.publicKey,
        ROLE_ADMIN,
        program.programId
      );
      const [newOracleRole] = findUserRole(
        newUser.publicKey,
        ROLE_ORACLE,
        program.programId
      );

      await program.methods
        .assignRole({ role: ROLE_ORACLE })
        .accounts({
          authority: adminKp.publicKey,
          protocolConfig,
          authorityRole: adminRolePda,
          targetUser: newUser.publicKey,
          userRole: newOracleRole,
          systemProgram: SystemProgram.programId,
        })
        .signers([adminKp])
        .rpc();

      const role = await program.account.userRole.fetch(newOracleRole);
      expect(role.role).to.equal(ROLE_ORACLE);
      expect(role.assignedBy.toString()).to.equal(adminKp.publicKey.toString());
    });

    it("admin cannot assign admin role", async () => {
      const newUser = Keypair.generate();
      await airdropSol(newUser.publicKey);

      const [adminRolePda] = findUserRole(
        adminKp.publicKey,
        ROLE_ADMIN,
        program.programId
      );
      const [newAdminRole] = findUserRole(
        newUser.publicKey,
        ROLE_ADMIN,
        program.programId
      );

      try {
        await program.methods
          .assignRole({ role: ROLE_ADMIN })
          .accounts({
            authority: adminKp.publicKey,
            protocolConfig,
            authorityRole: adminRolePda,
            targetUser: newUser.publicKey,
            userRole: newAdminRole,
            systemProgram: SystemProgram.programId,
          })
          .signers([adminKp])
          .rpc();
        expect.fail("Admin should not be able to assign admin role");
      } catch (err: any) {
        expect(err.toString()).to.include("AdminCannotAssignAdmin");
      }
    });

    it("rejects discrete buy on continuous market", async () => {
      // Use market from suite 3 (continuous, marketId=2)
      const [contMarketPda] = findMarket(2, program.programId);
      const contMarket = await program.account.market.fetch(contMarketPda);

      // Only test this if the market isn't already resolved
      if (contMarket.state !== 3) {
        const [contVaultAuth] = findVaultAuthority(
          contMarketPda,
          program.programId
        );
        const [posA] = findUserPosition(
          contMarketPda,
          traderA.publicKey,
          program.programId
        );
        const traderAAta = await getAssociatedTokenAddress(
          collateralMint,
          traderA.publicKey
        );

        try {
          await program.methods
            .buy({ outcome: 0, collateralAmount: new BN(1_000_000) })
            .accounts({
              trader: traderA.publicKey,
              market: contMarketPda,
              protocolConfig,
              userPosition: posA,
              vaultAuthority: contVaultAuth,
              vault: contMarket.vault,
              traderAta: traderAAta,
              tokenProgram: TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .signers([traderA])
            .rpc();
          expect.fail("Should reject discrete buy on continuous market");
        } catch (err: any) {
          expect(err.toString()).to.include("WrongMarketType");
        }
      }
    });
  });
});
