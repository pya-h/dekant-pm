#!/usr/bin/env ts-node
import { Command } from "commander";
import {
  loadContext,
  findProtocolConfig,
  findUserRole,
  findMarket,
  findVaultAuthority,
  findUserPosition,
  findLpPosition,
  getOrCreateAta,
  mintTokens,
  createCollateralMint,
  getTokenBalance,
  parseDeadline,
  parseTokenAmount,
  formatTokenAmount,
  formatTimestamp,
  formatProbability,
  computeProbabilities,
  printTable,
  ROLE_ORACLE,
  ROLE_CREATOR,
  MARKET_TYPE_BINARY,
  MARKET_TYPE_MULTI,
  MARKET_TYPE_CONTINUOUS,
  MARKET_TYPE_NAMES,
  MARKET_STATE_NAMES,
  SCALE,
  BN,
  PublicKey,
  Keypair,
  SystemProgram,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "./common";

const program_ = new Command();

program_
  .name("market")
  .description("DekantPM market management");

// ─── create-binary ───────────────────────────────────────────────────────────
program_
  .command("create-binary")
  .description("Create a binary (yes/no) market")
  .argument("<oracle>", "Oracle wallet public key")
  .argument("<liquidity>", "Initial liquidity in tokens (e.g. 10)")
  .argument("<deadline>", "Deadline: +1h, +7d, ISO 8601, or unix timestamp")
  .option("--mint <address>", "Collateral mint address (creates new if omitted)")
  .action(async (oracleStr, liquidityStr, deadlineStr, opts) => {
    await createMarketHelper({
      marketType: MARKET_TYPE_BINARY,
      numOutcomes: 2,
      oracle: new PublicKey(oracleStr),
      liquidity: parseTokenAmount(liquidityStr),
      deadline: parseDeadline(deadlineStr),
      rangeMin: new BN(0),
      rangeMax: new BN(0),
      mintAddress: opts.mint ? new PublicKey(opts.mint) : undefined,
    });
  });

// ─── create-multi ────────────────────────────────────────────────────────────
program_
  .command("create-multi")
  .description("Create a multi-outcome market")
  .argument("<oracle>", "Oracle wallet public key")
  .argument("<liquidity>", "Initial liquidity in tokens")
  .argument("<deadline>", "Deadline: +1h, +7d, ISO 8601, or unix timestamp")
  .argument("<num-outcomes>", "Number of outcomes (3-32)")
  .option("--mint <address>", "Collateral mint address (creates new if omitted)")
  .action(async (oracleStr, liquidityStr, deadlineStr, numStr, opts) => {
    const numOutcomes = parseInt(numStr, 10);
    if (numOutcomes < 2 || numOutcomes > 32) {
      throw new Error("Number of outcomes must be 2-32");
    }
    await createMarketHelper({
      marketType: MARKET_TYPE_MULTI,
      numOutcomes,
      oracle: new PublicKey(oracleStr),
      liquidity: parseTokenAmount(liquidityStr),
      deadline: parseDeadline(deadlineStr),
      rangeMin: new BN(0),
      rangeMax: new BN(0),
      mintAddress: opts.mint ? new PublicKey(opts.mint) : undefined,
    });
  });

// ─── create-continuous ───────────────────────────────────────────────────────
program_
  .command("create-continuous")
  .description("Create a continuous (distribution) market")
  .argument("<oracle>", "Oracle wallet public key")
  .argument("<liquidity>", "Initial liquidity in tokens")
  .argument("<deadline>", "Deadline: +1h, +7d, ISO 8601, or unix timestamp")
  .argument("<range-min>", "Lower bound of range (human-readable, e.g. 50)")
  .argument("<range-max>", "Upper bound of range (human-readable, e.g. 500)")
  .option("--bins <n>", "Number of bins (default: 64)", "64")
  .option("--mint <address>", "Collateral mint address (creates new if omitted)")
  .action(async (oracleStr, liquidityStr, deadlineStr, rangeMinStr, rangeMaxStr, opts) => {
    const numBins = parseInt(opts.bins, 10);
    if (numBins < 2 || numBins > 256) {
      throw new Error("Number of bins must be 2-256");
    }
    const rangeMin = new BN(rangeMinStr).mul(SCALE);
    const rangeMax = new BN(rangeMaxStr).mul(SCALE);
    if (rangeMin.gte(rangeMax)) {
      throw new Error("range-min must be less than range-max");
    }
    await createMarketHelper({
      marketType: MARKET_TYPE_CONTINUOUS,
      numOutcomes: numBins,
      oracle: new PublicKey(oracleStr),
      liquidity: parseTokenAmount(liquidityStr),
      deadline: parseDeadline(deadlineStr),
      rangeMin,
      rangeMax,
      mintAddress: opts.mint ? new PublicKey(opts.mint) : undefined,
    });
  });

// ─── pause ───────────────────────────────────────────────────────────────────
program_
  .command("pause")
  .description("Pause an active market")
  .argument("<market-id>", "Market ID (numeric)")
  .action(async (marketIdStr) => {
    const { program, keypair, programId } = loadContext();
    const marketId = parseInt(marketIdStr, 10);
    const [protocolConfig] = findProtocolConfig(programId);
    const [marketPda] = findMarket(marketId, programId);

    console.log(`Pausing market #${marketId}...`);

    const tx = await program.methods
      .pauseMarket()
      .accountsPartial({
        authority: keypair.publicKey,
        protocolConfig,
        authorityRole: null,
        market: marketPda,
      })
      .rpc();

    console.log(`  Market paused! Tx: ${tx}`);
  });

// ─── unpause ─────────────────────────────────────────────────────────────────
program_
  .command("unpause")
  .description("Unpause a paused market")
  .argument("<market-id>", "Market ID (numeric)")
  .action(async (marketIdStr) => {
    const { program, keypair, programId } = loadContext();
    const marketId = parseInt(marketIdStr, 10);
    const [protocolConfig] = findProtocolConfig(programId);
    const [marketPda] = findMarket(marketId, programId);

    console.log(`Unpausing market #${marketId}...`);

    const tx = await program.methods
      .unpauseMarket()
      .accountsPartial({
        authority: keypair.publicKey,
        protocolConfig,
        authorityRole: null,
        market: marketPda,
      })
      .rpc();

    console.log(`  Market unpaused! Tx: ${tx}`);
  });

// ─── claim ───────────────────────────────────────────────────────────────────
program_
  .command("claim")
  .description("Claim payout from a resolved market")
  .argument("<market-id>", "Market ID (numeric)")
  .action(async (marketIdStr) => {
    const ctx = loadContext();
    const marketId = parseInt(marketIdStr, 10);
    const [protocolConfig] = findProtocolConfig(ctx.programId);
    const [marketPda] = findMarket(marketId, ctx.programId);
    const [vaultAuthority] = findVaultAuthority(marketPda, ctx.programId);
    const [userPosition] = findUserPosition(marketPda, ctx.keypair.publicKey, ctx.programId);

    const market = await ctx.program.account.market.fetch(marketPda);
    const traderAta = await getOrCreateAta(
      ctx.connection,
      market.collateralMint,
      ctx.keypair.publicKey,
      ctx.keypair
    );

    // Show holdings before claim
    try {
      const position = await ctx.program.account.userPosition.fetch(userPosition);
      if (position.claimed) {
        console.log(`  Payout already claimed for market #${marketId}`);
        return;
      }
      console.log(`Claiming payout from market #${marketId}...`);
      console.log(`  Winning outcome: ${market.resolvedOutcome}`);
      const winHoldings = position.holdings[market.resolvedOutcome];
      console.log(`  Your winning holdings: ${winHoldings.toString()}`);
    } catch {
      console.log(`  No position found for market #${marketId}`);
      return;
    }

    const balanceBefore = await getTokenBalance(ctx.connection, traderAta);

    const tx = await ctx.program.methods
      .claimPayout()
      .accountsPartial({
        trader: ctx.keypair.publicKey,
        market: marketPda,
        protocolConfig,
        userPosition,
        vaultAuthority,
        vault: market.vault,
        traderAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const balanceAfter = await getTokenBalance(ctx.connection, traderAta);

    console.log(`  Payout claimed! Tx: ${tx}`);
    console.log(`  Net payout: ${formatTokenAmount(balanceAfter - balanceBefore)}`);
  });

// ─── info ────────────────────────────────────────────────────────────────────
program_
  .command("info")
  .description("Display market details and current state")
  .argument("<market-id>", "Market ID (numeric)")
  .action(async (marketIdStr) => {
    const { program, programId, connection } = loadContext();
    const marketId = parseInt(marketIdStr, 10);
    const [marketPda] = findMarket(marketId, programId);

    const market = await program.account.market.fetch(marketPda);

    const probs = computeProbabilities(market.reserves, market.totalMinted);
    const vaultBalance = await getTokenBalance(connection, market.vault);

    console.log(`\nMarket #${marketId}:`);
    printTable([
      ["PDA", marketPda.toBase58()],
      ["Type", MARKET_TYPE_NAMES[market.marketType] || `Unknown(${market.marketType})`],
      ["State", MARKET_STATE_NAMES[market.state] || `Unknown(${market.state})`],
      ["Creator", market.creator.toBase58()],
      ["Oracle", market.oracle.toBase58()],
      ["Collateral mint", market.collateralMint.toBase58()],
      ["Vault", market.vault.toBase58()],
      ["Vault balance", formatTokenAmount(vaultBalance)],
      ["Deadline", formatTimestamp(market.deadline.toNumber())],
      ["Created", formatTimestamp(market.createdAt.toNumber())],
      ["Num outcomes", market.numOutcomes.toString()],
      ["Total minted", market.totalMinted.toString()],
      ["k²", market.kSquared.toString()],
      ["LP shares total", market.lpSharesTotal.toString()],
      ["LP fee accumulated", market.lpFeeAccumulated.toString()],
      ["Protocol fee", formatTokenAmount(market.protocolFeeAccumulated)],
    ]);

    if (market.marketType === MARKET_TYPE_CONTINUOUS) {
      const rangeMin = Number(market.rangeMin.toString()) / Number(SCALE.toString());
      const rangeMax = Number(market.rangeMax.toString()) / Number(SCALE.toString());
      console.log(`\n  Range: [${rangeMin}, ${rangeMax}]`);
    }

    if (market.state === 3) { // Resolved
      console.log(`\n  Resolved outcome: ${market.resolvedOutcome}`);
      if (market.marketType === MARKET_TYPE_CONTINUOUS) {
        const resolvedVal = Number(market.resolvedValue.toString()) / Number(SCALE.toString());
        console.log(`  Resolved value: ${resolvedVal}`);
      }
      console.log(`  Resolved at: ${formatTimestamp(market.resolvedAt.toNumber())}`);
    }

    console.log("\n  Probabilities:");
    for (let i = 0; i < probs.length; i++) {
      const reserve = market.reserves[i];
      const label = market.marketType === MARKET_TYPE_BINARY
        ? (i === 0 ? "Yes" : "No")
        : market.marketType === MARKET_TYPE_CONTINUOUS
          ? `Bin ${i}`
          : `Outcome ${i}`;
      console.log(`    ${label.padEnd(12)} ${formatProbability(probs[i]).padStart(8)}  (reserve: ${reserve.toString()})`);
    }
  });

// ─── Shared create helper ────────────────────────────────────────────────────
interface CreateOpts {
  marketType: number;
  numOutcomes: number;
  oracle: PublicKey;
  liquidity: BN;
  deadline: number;
  rangeMin: BN;
  rangeMax: BN;
  mintAddress?: PublicKey;
}

async function createMarketHelper(opts: CreateOpts) {
  const { program, keypair, programId, connection } = loadContext();
  const [protocolConfig] = findProtocolConfig(programId);

  // Get next market ID
  const config = await program.account.protocolConfig.fetch(protocolConfig);
  const marketId = config.marketCount.toNumber();
  const [marketPda] = findMarket(marketId, programId);
  const [vaultAuthority] = findVaultAuthority(marketPda, programId);
  const vaultKp = Keypair.generate();

  // Collateral mint: use provided or create a new one
  let collateralMint: PublicKey;
  if (opts.mintAddress) {
    collateralMint = opts.mintAddress;
  } else {
    console.log("Creating new collateral mint...");
    collateralMint = await createCollateralMint(connection, keypair);
    console.log(`  Mint: ${collateralMint.toBase58()}`);
  }

  // Ensure creator has enough tokens
  const creatorAta = await getOrCreateAta(connection, collateralMint, keypair.publicKey, keypair);

  // If we created the mint, mint tokens to the creator
  if (!opts.mintAddress) {
    const mintAmount = opts.liquidity.muln(5); // Mint 5x the liquidity to have headroom
    await mintTokens(connection, collateralMint, creatorAta, keypair, BigInt(mintAmount.toString()));
    console.log(`  Minted ${formatTokenAmount(mintAmount)} tokens to creator`);
  }

  // Derive role PDAs
  const [oracleRolePda] = findUserRole(opts.oracle, ROLE_ORACLE, programId);
  const [creatorRolePda] = findUserRole(keypair.publicKey, ROLE_CREATOR, programId);
  const [creatorLpPos] = findLpPosition(marketPda, keypair.publicKey, programId);

  const typeName = MARKET_TYPE_NAMES[opts.marketType];
  console.log(`\nCreating ${typeName} market #${marketId}...`);
  printTable([
    ["Oracle", opts.oracle.toBase58()],
    ["Liquidity", formatTokenAmount(opts.liquidity)],
    ["Deadline", formatTimestamp(opts.deadline)],
    ["Outcomes/bins", opts.numOutcomes.toString()],
    ...(opts.marketType === MARKET_TYPE_CONTINUOUS
      ? [
          ["Range min", (Number(opts.rangeMin.toString()) / Number(SCALE.toString())).toString()] as [string, string],
          ["Range max", (Number(opts.rangeMax.toString()) / Number(SCALE.toString())).toString()] as [string, string],
        ]
      : []),
  ]);

  const tx = await program.methods
    .createMarket({
      marketType: opts.marketType,
      numOutcomes: opts.numOutcomes,
      deadline: new BN(opts.deadline),
      oracle: opts.oracle,
      initialLiquidity: opts.liquidity,
      rangeMin: opts.rangeMin,
      rangeMax: opts.rangeMax,
    })
    .accountsPartial({
      creator: keypair.publicKey,
      creatorRole: creatorRolePda,
      protocolConfig,
      oracleRole: oracleRolePda,
      market: marketPda,
      collateralMint,
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

  console.log(`\n  Market created! Tx: ${tx}`);
  console.log(`  Market ID:  ${marketId}`);
  console.log(`  Market PDA: ${marketPda.toBase58()}`);
  console.log(`  Vault:      ${vaultKp.publicKey.toBase58()}`);
  if (!opts.mintAddress) {
    console.log(`  Mint:       ${collateralMint.toBase58()}`);
  }
}

program_.parse(process.argv);
