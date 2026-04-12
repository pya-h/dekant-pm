const { select, input } = require("@inquirer/prompts");
const chalk = require("chalk");
const {
  clear,
  pressKey,
  showError,
  showSuccess,
  showInfo,
  printKV,
} = require("../ui");
const { selectUser } = require("../prompts/user-select");
const { selectMarket } = require("../prompts/market-select");
const {
  Keypair,
  SystemProgram,
  BN,
  findProtocolConfig,
  findUserRole,
  findMarket,
  findVaultAuthority,
  findLpPosition,
  getOrCreateAta,
  mintTokens,
  createCollateralMint,
  parseTokenAmount,
  parseDeadline,
  formatTokenAmount,
  SCALE,
  ROLE_ADMIN,
  ROLE_ORACLE,
  ROLE_CREATOR,
  MARKET_TYPE_BINARY,
  MARKET_TYPE_MULTI,
  MARKET_TYPE_CONTINUOUS,
  MARKET_TYPE_NAMES,
  MARKET_STATE_NAMES,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} = require("../common");

// ─── Create Market ───────────────────────────────────────────────────────────

async function createMarket(state) {
  // Step 1: type
  const marketType = await select({
    message: "Market type:",
    choices: [
      { name: "Binary (Yes/No)", value: MARKET_TYPE_BINARY },
      { name: "Multi-outcome", value: MARKET_TYPE_MULTI },
      { name: "Continuous (Range)", value: MARKET_TYPE_CONTINUOUS },
    ],
  });

  // Step 2: common params
  const liquidityStr = await input({
    message: "Initial liquidity (USDC):",
    default: "100",
  });
  const deadlineStr = await input({
    message: "Deadline (+1h, +30m, +7d, ISO, unix):",
    default: "+1h",
  });

  // Step 3: type-specific
  let numOutcomes = 2;
  let rangeMin = new BN(0);
  let rangeMax = new BN(0);
  let rangeMinHuman, rangeMaxHuman;

  if (marketType === MARKET_TYPE_MULTI) {
    const numStr = await input({
      message: "Number of outcomes (3-32):",
      default: "4",
    });
    numOutcomes = parseInt(numStr, 10);
    if (numOutcomes < 3 || numOutcomes > 32) {
      console.log(chalk.red("  Invalid: must be 3-32"));
      await pressKey();
      return;
    }
  } else if (marketType === MARKET_TYPE_CONTINUOUS) {
    const minStr = await input({ message: "Range min:", default: "50" });
    const maxStr = await input({ message: "Range max:", default: "500" });
    const binsStr = await input({
      message: "Number of bins (2-256):",
      default: "64",
    });
    numOutcomes = parseInt(binsStr, 10);
    if (numOutcomes < 2 || numOutcomes > 256) {
      console.log(chalk.red("  Invalid: bins must be 2-256"));
      await pressKey();
      return;
    }
    rangeMinHuman = parseFloat(minStr);
    rangeMaxHuman = parseFloat(maxStr);
    rangeMin = new BN(minStr).mul(SCALE);
    rangeMax = new BN(maxStr).mul(SCALE);
    if (rangeMin.gte(rangeMax)) {
      console.log(chalk.red("  Invalid: range-min must be < range-max"));
      await pressKey();
      return;
    }
  }

  // Step 4: oracle
  console.log(chalk.dim("\n  Select oracle for this market:"));
  const oracle = await selectUser(state, {
    message: "Oracle:",
    includeSuperuser: true,
    includeCancel: true,
  });
  if (!oracle || oracle === "cancel") return;

  // Check oracle role, offer to assign
  const oracleSessionUser = state.findUser(oracle.pubkey);
  const isSuperuser = oracle.pubkey.equals(state.superuser.pubkey);
  if (
    oracleSessionUser &&
    !oracleSessionUser.roles.includes("Oracle") &&
    !isSuperuser
  ) {
    console.log(
      chalk.yellow(`\n  Warning: ${oracle.label} does not have Oracle role.`)
    );
    const fix = await select({
      message: "Assign Oracle role now?",
      choices: [
        { name: "Yes, assign it (via superuser)", value: true },
        { name: "No, continue anyway", value: false },
      ],
    });
    if (fix) {
      try {
        const [protocolConfig] = findProtocolConfig(state.programId);
        const [userRole] = findUserRole(
          oracle.pubkey,
          ROLE_ORACLE,
          state.programId
        );
        await state.superProgram.methods
          .assignRole({ role: ROLE_ORACLE })
          .accountsPartial({
            authority: state.superuser.pubkey,
            protocolConfig,
            authorityRole: null,
            targetUser: oracle.pubkey,
            userRole,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        if (oracleSessionUser) oracleSessionUser.roles.push("Oracle");
        showSuccess("Oracle role assigned");
      } catch (e) {
        showError(e);
        await pressKey();
        return;
      }
    }
  }

  // Step 5: label
  const typeName = MARKET_TYPE_NAMES[marketType];
  const defaultLabel = `Market #${state.markets.length} (${typeName})`;
  const label = await input({
    message: "Market label (optional):",
    default: defaultLabel,
  });

  // Step 6: creator selection with retry loop
  let created = false;
  while (!created) {
    clear();
    console.log(chalk.bold(`\n  Create ${typeName} Market`));
    printKV([
      ["Liquidity", `${liquidityStr} USDC`],
      ["Deadline", deadlineStr],
      ["Outcomes/bins", numOutcomes.toString()],
      [
        "Oracle",
        `${oracle.label} (${oracle.pubkey.toBase58().slice(0, 12)}...)`,
      ],
      ...(marketType === MARKET_TYPE_CONTINUOUS
        ? [["Range", `[${rangeMinHuman}, ${rangeMaxHuman}]`]]
        : []),
    ]);
    console.log();

    const creator = await selectUser(state, {
      message: "Create market as:",
      includeSuperuser: true,
      includeCancel: true,
    });
    if (!creator || creator === "cancel") return;

    try {
      const result = await executeCreateMarket(state, {
        marketType,
        numOutcomes,
        oracle: oracle.pubkey,
        liquidity: parseTokenAmount(liquidityStr),
        deadline: parseDeadline(deadlineStr),
        rangeMin,
        rangeMax,
        creator,
      });

      state.markets.push({
        id: result.marketId,
        label,
        type: marketType,
        mint: result.mint,
        oracle: oracle.pubkey,
        numOutcomes,
        rangeMin: rangeMinHuman,
        rangeMax: rangeMaxHuman,
      });

      showSuccess(`Market #${result.marketId} created!`);
      printKV([
        ["Market ID", result.marketId.toString()],
        ["Market PDA", result.marketPda.toBase58()],
        ["Vault", result.vault.toBase58()],
        ["Mint", result.mint.toBase58()],
      ]);
      created = true;
    } catch (e) {
      showError(e);
      console.log(chalk.dim("  Select a different user or Cancel."));
    }
  }

  await pressKey();
}

async function executeCreateMarket(state, opts) {
  const program = state.programForUser(opts.creator.keypair);
  const [protocolConfig] = findProtocolConfig(state.programId);

  const config = await program.account.protocolConfig.fetch(protocolConfig);
  const marketId = config.marketCount.toNumber();
  const [marketPda] = findMarket(marketId, state.programId);
  const [vaultAuthority] = findVaultAuthority(marketPda, state.programId);
  const vaultKp = Keypair.generate();

  // Create mint with superuser as authority
  showInfo("Creating collateral mint (superuser as authority)...");
  const collateralMint = await createCollateralMint(
    state.connection,
    state.superuser.keypair
  );

  // Fund creator for initial liquidity
  const creatorAta = await getOrCreateAta(
    state.connection,
    collateralMint,
    opts.creator.pubkey,
    state.superuser.keypair
  );
  const mintAmount = opts.liquidity.muln(5);
  await mintTokens(
    state.connection,
    collateralMint,
    creatorAta,
    state.superuser.keypair,
    BigInt(mintAmount.toString())
  );
  showInfo(
    `Minted ${formatTokenAmount(mintAmount)} USDC to ${opts.creator.label}`
  );

  // Derive PDAs
  const [oracleRolePda] = findUserRole(
    opts.oracle,
    ROLE_ORACLE,
    state.programId
  );
  const [creatorRolePda] = findUserRole(
    opts.creator.pubkey,
    ROLE_CREATOR,
    state.programId
  );
  const [creatorLpPos] = findLpPosition(
    marketPda,
    opts.creator.pubkey,
    state.programId
  );

  showInfo("Sending create_market transaction...");

  await program.methods
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
      creator: opts.creator.pubkey,
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

  return { marketId, marketPda, vault: vaultKp.publicKey, mint: collateralMint };
}

// ─── Pause / Unpause ─────────────────────────────────────────────────────────

async function pauseUnpause(state) {
  const market = await selectMarket(state, {
    message: "Select market to pause/unpause:",
  });
  if (!market || market === "cancel") return;

  const [marketPda] = findMarket(market.id, state.programId);
  const marketData = await state.superProgram.account.market.fetch(marketPda);
  const isPaused = marketData.state === 1;
  const action = isPaused ? "Unpause" : "Pause";

  console.log(
    chalk.dim(
      `\n  Market #${market.id} is currently ${MARKET_STATE_NAMES[marketData.state]}`
    )
  );

  let done = false;
  while (!done) {
    const user = await selectUser(state, {
      message: `${action} market as:`,
      includeSuperuser: true,
      includeCancel: true,
    });
    if (!user || user === "cancel") return;

    try {
      const program = state.programForUser(user.keypair);
      const [protocolConfig] = findProtocolConfig(state.programId);

      // Derive authorityRole: null for superuser, Admin PDA for Admin users
      const isSuperuser = user.pubkey.equals(state.superuser.pubkey);
      let authorityRole = null;
      if (!isSuperuser) {
        const sessionUser = state.findUser(user.pubkey);
        if (sessionUser && sessionUser.roles.includes("Admin")) {
          [authorityRole] = findUserRole(user.pubkey, ROLE_ADMIN, state.programId);
        }
      }

      if (isPaused) {
        await program.methods
          .unpauseMarket()
          .accountsPartial({
            authority: user.pubkey,
            protocolConfig,
            authorityRole,
            market: marketPda,
          })
          .rpc();
      } else {
        await program.methods
          .pauseMarket()
          .accountsPartial({
            authority: user.pubkey,
            protocolConfig,
            authorityRole,
            market: marketPda,
          })
          .rpc();
      }

      showSuccess(`Market #${market.id} ${action.toLowerCase()}d!`);
      done = true;
    } catch (e) {
      showError(e);
      console.log(chalk.dim("  Select a different user or Cancel."));
    }
  }

  await pressKey();
}

module.exports = { createMarket, pauseUnpause };
