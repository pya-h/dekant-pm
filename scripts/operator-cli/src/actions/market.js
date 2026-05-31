const { select, input, confirm } = require("@inquirer/prompts");
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
  PublicKey,
  SystemProgram,
  BN,
  findProtocolConfig,
  findUserRole,
  findMarket,
  findVaultAuthority,
  findLpPosition,
  getOrCreateAta,
  deriveAta,
  mintTokens,
  getTokenBalance,
  getNetworkMints,
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
  MARKET_STATE_PAUSED,
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
    ...(state.randomMode && { default: state.rand.marketType() }),
  });

  // Step 2: common params
  const liquidityStr = await input({
    message: "Initial collateral for liquidity:",
    default: state.randomMode ? state.rand.liquidity() : "100",
  });
  const deadlineStr = await input({
    message: "Deadline (+1h, +30m, +7d, ISO, unix):",
    default: state.randomMode ? state.rand.deadline() : "+1h",
  });

  // Step 3: type-specific
  let numOutcomes = 2;
  let rangeMin = new BN(0);
  let rangeMax = new BN(0);
  let rangeMinHuman, rangeMaxHuman;
  // kernel_width is only meaningful for continuous markets; binary/multi force 0
  // (the on-chain handler also forces it, but we keep the client honest).
  let kernelWidth = 0;

  if (marketType === MARKET_TYPE_MULTI) {
    const numStr = await input({
      message: "Number of outcomes (3-32):",
      default: state.randomMode ? state.rand.numOutcomes(marketType) : "4",
    });
    numOutcomes = parseInt(numStr, 10);
    if (numOutcomes < 3 || numOutcomes > 32) {
      console.log(chalk.red("  Invalid: must be 3-32"));
      await pressKey();
      return;
    }
  } else if (marketType === MARKET_TYPE_CONTINUOUS) {
    const randRange = state.randomMode ? state.rand.rangeValues() : null;
    const minStr = await input({
      message: "Range min:",
      default: randRange ? randRange.min : "50",
    });
    const maxStr = await input({
      message: "Range max:",
      default: randRange ? randRange.max : "500",
    });
    const binsStr = await input({
      message: "Number of bins (2-256):",
      default: state.randomMode ? state.rand.numOutcomes(marketType) : "64",
    });
    numOutcomes = parseInt(binsStr, 10);
    if (numOutcomes < 2 || numOutcomes > 256) {
      console.log(chalk.red("  Invalid: bins must be 2-256"));
      await pressKey();
      return;
    }
    rangeMinHuman = parseFloat(minStr);
    rangeMaxHuman = parseFloat(maxStr);
    rangeMin = new BN(Math.round(parseFloat(minStr) * 1e9).toString());
    rangeMax = new BN(Math.round(parseFloat(maxStr) * 1e9).toString());
    if (rangeMin.gte(rangeMax)) {
      console.log(chalk.red("  Invalid: range-min must be < range-max"));
      await pressKey();
      return;
    }
    // Step 3b: kernel width (continuous only)
    const kwDefault = state.randomMode
      ? state.rand.kernelWidth(numOutcomes - 1)
      : "0";
    const kwStr = await input({
      message: `Kernel width [0..${numOutcomes - 1}] (0 = winner-take-all):`,
      default: kwDefault,
    });
    kernelWidth = parseInt(kwStr, 10);
    if (!Number.isFinite(kernelWidth) || kernelWidth < 0 || kernelWidth >= numOutcomes) {
      console.log(
        chalk.red(`  Invalid: kernel-width must be an integer in [0..${numOutcomes - 1}]`),
      );
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
        state.logError("Assign Oracle Role", e);
        await pressKey();
        return;
      }
    }
  }

  // Step 5: label
  const typeName = MARKET_TYPE_NAMES[marketType];
  const defaultLabel = `Market #${state.markets.length} (${typeName})`;
  const label = state.randomMode
    ? defaultLabel
    : await input({
        message: "Market label (optional):",
        default: defaultLabel,
      });

  // Step 6: collateral token source
  const mintSourceChoices = [
    { name: "Create new SPL token", value: "new" },
    { name: "Native SOL (wrapped)", value: "native" },
    { name: "Enter mint address", value: "address" },
    { name: "Browse network tokens", value: "network" },
  ];
  if (state.markets.length > 0) {
    mintSourceChoices.push({ name: "From market collateral", value: "market" });
  }
  mintSourceChoices.push({ name: chalk.dim("Cancel"), value: "cancel" });

  const mintSource = state.randomMode
    ? "new"
    : await select({
        message: "Collateral token source:",
        choices: mintSourceChoices,
      });
  if (mintSource === "cancel") return;

  let selectedMint = null;
  let isNewMint = false;
  let isNativeMint = false;
  let mintLabel = "";

  if (mintSource === "new") {
    isNewMint = true;
  } else if (mintSource === "native") {
    isNativeMint = true;
    selectedMint = new PublicKey("So11111111111111111111111111111111111111112");
    mintLabel = "Wrapped SOL";
  } else if (mintSource === "address") {
    const addrStr = await input({
      message: "Token mint address:",
    });
    try {
      selectedMint = new PublicKey(addrStr);
    } catch {
      console.log(chalk.red(`  Invalid mint address: ${addrStr}`));
      await pressKey();
      return;
    }
    mintLabel = addrStr.slice(0, 12) + "...";
  } else if (mintSource === "network") {
    showInfo("Fetching token mints from network...");
    try {
      const netMints = await getNetworkMints(state.connection);
      if (netMints.length === 0) {
        console.log(chalk.yellow("  No token mints found on the network."));
        await pressKey();
        return;
      }
      const mintChoices = netMints.map((m) => {
        const addr = m.toBase58();
        // Annotate known mints from session
        const known = findMintLabel(state, m);
        const displayName = known
          ? `${known} — ${addr.slice(0, 12)}...`
          : addr;
        return { name: displayName, value: addr };
      });
      mintChoices.push({ name: chalk.dim("Cancel"), value: "cancel" });
      const chosen = await select({
        message: `Select token mint (${netMints.length} found):`,
        choices: mintChoices,
      });
      if (chosen === "cancel") return;
      selectedMint = new PublicKey(chosen);
      mintLabel = findMintLabel(state, selectedMint) || chosen.slice(0, 12) + "...";
    } catch (e) {
      showError(e);
      state.logError("Browse Network Tokens", e);
      await pressKey();
      return;
    }
  } else if (mintSource === "market") {
    const mkt = await selectMarket(state, {
      message: "Select market (for collateral mint):",
      includeCancel: true,
    });
    if (!mkt || mkt === "cancel") return;
    selectedMint = mkt.mint;
    mintLabel = mkt.mintLabel || `Market #${mkt.id} Token`;
  }

  // Step 7: balance check + creator selection
  let needsFunding = isNewMint; // new mints always need funding
  const liquidityAmount = parseTokenAmount(liquidityStr);

  // Creator selection with retry loop
  let created = false;
  while (!created) {
    clear();
    console.log(chalk.bold(`\n  Create ${typeName} Market`));
    printKV([
      ["Liquidity", `${liquidityStr} tokens`],
      ["Deadline", deadlineStr],
      ["Outcomes/bins", numOutcomes.toString()],
      [
        "Oracle",
        `${oracle.label} (${oracle.pubkey.toBase58().slice(0, 12)}...)`,
      ],
      ...(marketType === MARKET_TYPE_CONTINUOUS
        ? [
            ["Range", `[${rangeMinHuman}, ${rangeMaxHuman}]`],
            [
              "Kernel width",
              kernelWidth === 0 ? "0 (winner-take-all)" : kernelWidth.toString(),
            ],
          ]
        : []),
      [
        "Token",
        isNewMint
          ? "New SPL token (auto-created)"
          : isNativeMint
          ? "Wrapped SOL"
          : `${mintLabel} (${selectedMint.toBase58().slice(0, 12)}...)`,
      ],
    ]);
    console.log();

    const creator = await selectUser(state, {
      message: "Create market as:",
      includeSuperuser: true,
      includeCancel: true,
    });
    if (!creator || creator === "cancel") return;

    // Balance check for existing tokens
    if (!isNewMint && selectedMint) {
      showInfo("Checking creator token balance...");
      let balance = BigInt(0);
      try {
        const ata = deriveAta(selectedMint, creator.pubkey);
        balance = await getTokenBalance(state.connection, ata);
      } catch {
        // ATA doesn't exist — balance is 0
      }

      const needed = BigInt(liquidityAmount.toString());
      if (balance < needed) {
        const shortfall = needed - balance;
        const fundMsg = isNativeMint
          ? `Creator has ${formatTokenAmount(balance)} wrapped SOL but needs ${liquidityStr}. Wrap more SOL from superuser?`
          : `Creator has ${formatTokenAmount(balance)} tokens but needs ${liquidityStr}. Auto-fund via mint?`;
        const doFund = await select({
          message: fundMsg,
          choices: [
            { name: "Yes, fund the creator", value: true },
            { name: "No, cancel", value: false },
          ],
        });
        if (!doFund) {
          console.log(
            chalk.yellow(`  Insufficient balance (${formatTokenAmount(balance)} tokens, need ${liquidityStr}).`)
          );
          continue; // retry with different creator
        }
        needsFunding = true;
      } else {
        showInfo(
          `Creator balance: ${formatTokenAmount(balance)} tokens (sufficient)`
        );
        needsFunding = false;
      }
    }

    try {
      const result = await executeCreateMarket(state, {
        marketType,
        numOutcomes,
        oracle: oracle.pubkey,
        liquidity: liquidityAmount,
        deadline: parseDeadline(deadlineStr),
        rangeMin,
        rangeMax,
        kernelWidth,
        creator,
        selectedMint,
        isNewMint,
        isNativeMint,
        needsFunding,
      });

      state.markets.push({
        id: result.marketId,
        label,
        type: marketType,
        mint: result.mint,
        mintLabel: result.mintLabel,
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
        ["Token", `${result.mintLabel} (${result.mint.toBase58()})`],
      ]);
      created = true;
    } catch (e) {
      showError(e);
      state.logError("Create Market", e);
      console.log(chalk.dim("  Select a different user or Cancel."));
    }
  }

  await pressKey();
}

async function executeCreateMarket(state, opts) {
  const program = state.programForUser(opts.creator.keypair);
  const [protocolConfig] = findProtocolConfig(state.programId);

  // Step 1: Fetch protocol config
  showInfo("Fetching protocol config...");
  const config = await program.account.protocolConfig.fetch(protocolConfig);
  const marketId = config.marketCount.toNumber();
  showInfo(`  ✓ Protocol config loaded — next market ID: ${marketId}`);

  const [marketPda] = findMarket(marketId, state.programId);
  const [vaultAuthority] = findVaultAuthority(marketPda, state.programId);
  const vaultKp = Keypair.generate();

  // Step 2: Resolve or create mint
  let collateralMint;
  let mintLabel;

  if (opts.isNewMint) {
    showInfo("Creating new SPL token (superuser as authority)...");
    collateralMint = await createCollateralMint(
      state.connection,
      state.superuser.keypair
    );
    mintLabel = `Market #${marketId} Token`;
    showInfo(
      `  ✓ Created SPL token: ${mintLabel} (${collateralMint.toBase58().slice(0, 12)}...)`
    );
  } else {
    collateralMint = opts.selectedMint;
    mintLabel = opts.isNativeMint ? "Wrapped SOL" : findMintLabel(state, collateralMint) || collateralMint.toBase58().slice(0, 12) + "...";
    showInfo(
      `  ✓ Using token: ${mintLabel} (${collateralMint.toBase58().slice(0, 12)}...)`
    );
  }

  // Step 3: Create ATA + fund if needed
  showInfo("Preparing creator token account...");
  const creatorAta = await getOrCreateAta(
    state.connection,
    collateralMint,
    opts.creator.pubkey,
    state.superuser.keypair
  );
  showInfo(`  ✓ Creator ATA ready (${creatorAta.toBase58().slice(0, 12)}...)`);

  if (opts.needsFunding) {
    if (opts.isNewMint) {
      // New mint: fund 5x liquidity
      const mintAmount = opts.liquidity.muln(5);
      showInfo("Minting tokens to creator (5x liquidity)...");
      await mintTokens(
        state.connection,
        collateralMint,
        creatorAta,
        state.superuser.keypair,
        BigInt(mintAmount.toString())
      );
      showInfo(
        `  ✓ Minted ${formatTokenAmount(mintAmount)} tokens to ${opts.creator.label}`
      );
    } else if (opts.isNativeMint) {
      // Wrapped SOL: wrap the needed amount
      showInfo("Wrapping SOL for creator...");
      // For wrapped SOL, we need to transfer SOL to the ATA and sync native
      // This is handled by @solana/spl-token's createWrappedNativeAccount or manually
      const { Transaction: SolTx } = require("@solana/web3.js");
      const amount = BigInt(opts.liquidity.toString());
      // Convert token amount to lamports (USDC_DECIMALS=6 → ×10^3 for SOL's 9 decimals)
      const lamports = amount * BigInt(1000);
      const tx = new SolTx().add(
        SystemProgram.transfer({
          fromPubkey: state.superuser.keypair.publicKey,
          toPubkey: creatorAta,
          lamports: Number(lamports),
        }),
        // SyncNative instruction (variant 17)
        {
          keys: [{ pubkey: creatorAta, isSigner: false, isWritable: true }],
          programId: TOKEN_PROGRAM_ID,
          data: Buffer.from([17]),
        }
      );
      const sig = await state.connection.sendTransaction(
        tx,
        [state.superuser.keypair],
        { skipPreflight: false, preflightCommitment: "confirmed" }
      );
      await state.connection.confirmTransaction(sig, "confirmed");
      showInfo(`  ✓ Wrapped SOL to creator`);
    } else {
      // Existing SPL token: mint the shortfall
      showInfo("Funding creator via mint...");
      let currentBalance = BigInt(0);
      try {
        currentBalance = await getTokenBalance(state.connection, creatorAta);
      } catch {
        // no ATA yet = 0
      }
      const needed = BigInt(opts.liquidity.toString());
      const fundAmount = needed > currentBalance ? needed - currentBalance : needed;
      await mintTokens(
        state.connection,
        collateralMint,
        creatorAta,
        state.superuser.keypair,
        fundAmount
      );
      showInfo(
        `  ✓ Funded creator with ${formatTokenAmount(fundAmount)} tokens (superuser may need mint authority)`
      );
    }
  }

  // Step 4: Derive PDAs
  const [oracleRolePda] = findUserRole(
    opts.oracle,
    ROLE_ORACLE,
    state.programId
  );
  const isSuperuserCreator = opts.creator.pubkey.equals(state.superuser.pubkey);
  const sessionCreator = !isSuperuserCreator
    ? state.findUser(opts.creator.pubkey)
    : null;
  let creatorRoleType = ROLE_CREATOR;
  if (!isSuperuserCreator && sessionCreator) {
    if (
      !sessionCreator.roles.includes("Creator") &&
      sessionCreator.roles.includes("Admin")
    ) {
      creatorRoleType = ROLE_ADMIN;
    }
  }
  const [creatorRolePda] = findUserRole(
    opts.creator.pubkey,
    creatorRoleType,
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
      kernelWidth: opts.kernelWidth ?? 0,
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

  showInfo(`  ✓ Market #${marketId} created successfully`);

  return {
    marketId,
    marketPda,
    vault: vaultKp.publicKey,
    mint: collateralMint,
    mintLabel,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findMintLabel(state, mint) {
  const addr = mint.toBase58();
  if (addr === "So11111111111111111111111111111111111111112") return "Wrapped SOL";
  for (const m of state.markets) {
    if (m.mint.toBase58() === addr) {
      return m.mintLabel || `Market #${m.id} Token`;
    }
  }
  return "";
}

// ─── Pause / Unpause ─────────────────────────────────────────────────────────

async function pauseUnpause(state) {
  const market = await selectMarket(state, {
    message: "Select market to pause/unpause:",
  });
  if (!market || market === "cancel") return;

  const [marketPda] = findMarket(market.id, state.programId);
  const marketData = await state.superProgram.account.market.fetch(marketPda);
  const isPaused = marketData.state === MARKET_STATE_PAUSED;
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

      const isSuperuser = user.pubkey.equals(state.superuser.pubkey);
      let authorityRole = null;
      if (!isSuperuser) {
        [authorityRole] = findUserRole(user.pubkey, ROLE_ADMIN, state.programId);
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
      state.logError(`${action} Market`, e);
      console.log(chalk.dim("  Select a different user or Cancel."));
    }
  }

  await pressKey();
}

module.exports = { createMarket, pauseUnpause };
