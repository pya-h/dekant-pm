const { select, input } = require("@inquirer/prompts");
const chalk = require("chalk");
const { pressKey, showError, showSuccess, showInfo, printKV } = require("../ui");
const { selectUser } = require("../prompts/user-select");
const { selectMarket } = require("../prompts/market-select");
const {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  airdropSol,
  getOrCreateAta,
  mintTokens,
  getTokenBalance,
  transferSol,
  getNetworkMints,
  findProtocolConfig,
  findUserRole,
  parseTokenAmount,
  formatTokenAmount,
  ROLE_ADMIN,
  ROLE_ORACLE,
  ROLE_CREATOR,
  ROLE_NAMES,
} = require("../common");

// ─── Add New User ────────────────────────────────────────────────────────────

async function addUser(state) {
  const defaultLabel = state.randomMode
    ? state.rand.userLabel(state.users.length)
    : state.nextUserLabel();
  const label = await input({
    message: "User label:",
    default: defaultLabel,
  });

  console.log(chalk.dim("\n  Generating keypair..."));
  const keypair = Keypair.generate();
  console.log(`  Pubkey: ${keypair.publicKey.toBase58()}`);

  console.log(chalk.dim("  Airdropping 10 SOL..."));
  try {
    await airdropSol(state.connection, keypair.publicKey);
    showSuccess(`${label} created with 10 SOL`);
  } catch (e) {
    showError(e);
    console.log(
      chalk.dim("  User created but airdrop failed. Fund manually.")
    );
  }

  state.users.push({
    label,
    keypair,
    pubkey: keypair.publicKey,
    roles: [],
  });

  printKV([
    ["Label", label],
    ["Pubkey", keypair.publicKey.toBase58()],
  ]);

  await pressKey();
}

// ─── Assign Role ─────────────────────────────────────────────────────────────

async function assignRole(state) {
  if (state.users.length === 0) {
    console.log(chalk.yellow("  No users available. Add a user first."));
    await pressKey();
    return;
  }

  const selected = await selectUser(state, {
    message: "Select user to assign role:",
  });
  if (!selected || selected === "cancel") return;

  const role = await select({
    message: "Select role:",
    choices: [
      { name: "Oracle", value: ROLE_ORACLE },
      { name: "Creator", value: ROLE_CREATOR },
      { name: "Admin", value: ROLE_ADMIN },
    ],
    ...(state.randomMode && { default: state.rand.role() }),
  });

  const roleName = ROLE_NAMES[role];
  console.log(chalk.dim(`\n  Assigning ${roleName} to ${selected.label}...`));

  try {
    const program = state.superProgram;
    const [protocolConfig] = findProtocolConfig(state.programId);
    const [userRole] = findUserRole(selected.pubkey, role, state.programId);

    await program.methods
      .assignRole({ role })
      .accountsPartial({
        authority: state.superuser.pubkey,
        protocolConfig,
        authorityRole: null,
        targetUser: selected.pubkey,
        userRole,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const sessionUser = state.findUser(selected.pubkey);
    if (sessionUser && !sessionUser.roles.includes(roleName)) {
      sessionUser.roles.push(roleName);
    }

    showSuccess(`${roleName} role assigned to ${selected.label}`);
    if (sessionUser) {
      console.log(`  Roles: [${sessionUser.roles.join(", ")}]`);
    }
  } catch (e) {
    showError(e);
  }

  await pressKey();
}

// ─── Fund User ───────────────────────────────────────────────────────────────

async function fundUser(state) {
  if (state.users.length === 0) {
    console.log(chalk.yellow("  No users available. Add a user first."));
    await pressKey();
    return;
  }

  const selected = await selectUser(state, {
    message: "Select user to fund:",
  });
  if (!selected || selected === "cancel") return;

  // Build source choices
  const sourceChoices = [
    { name: "Enter mint address / Native SOL", value: "manual" },
    { name: "Browse network tokens", value: "network" },
  ];
  if (state.markets.length > 0) {
    sourceChoices.push({ name: "From market collateral", value: "market" });
  }
  sourceChoices.push({ name: chalk.red("Cancel"), value: "cancel" });

  const source = await select({
    message: "Token source:",
    choices: sourceChoices,
  });
  if (source === "cancel") return;

  let mint = null;
  let isSol = false;

  if (source === "manual") {
    const manualChoice = await select({
      message: "Select token type:",
      choices: [
        { name: "Native SOL (transfer)", value: "sol" },
        { name: "Enter mint address", value: "mint" },
        { name: chalk.red("Cancel"), value: "cancel" },
      ],
    });
    if (manualChoice === "cancel") return;

    if (manualChoice === "sol") {
      isSol = true;
    } else {
      const mintStr = await input({ message: "Token mint address:" });
      try {
        mint = new PublicKey(mintStr);
      } catch {
        console.log(chalk.red("  Invalid mint address."));
        await pressKey();
        return;
      }
    }
  } else if (source === "network") {
    console.log(chalk.dim("\n  Fetching token mints from network..."));
    try {
      const mints = await getNetworkMints(state.connection);
      if (mints.length === 0) {
        console.log(chalk.yellow("  No token mints found on the network."));
        await pressKey();
        return;
      }
      const mintChoices = mints.map((m) => ({
        name: m.toBase58(),
        value: m,
      }));
      mintChoices.push({ name: chalk.red("Cancel"), value: "cancel" });
      const selectedMint = await select({
        message: `Select token mint (${mints.length} found):`,
        choices: mintChoices,
      });
      if (selectedMint === "cancel") return;
      mint = selectedMint;
    } catch (e) {
      showError(e);
      await pressKey();
      return;
    }
  } else if (source === "market") {
    const market = await selectMarket(state, {
      message: "Select market (for collateral mint):",
    });
    if (!market || market === "cancel") return;
    mint = market.mint;
  }

  if (isSol) {
    const amountStr = await input({
      message: "Amount (SOL):",
      default: state.randomMode ? "5" : "10",
    });

    console.log(
      chalk.dim(`\n  Transferring ${amountStr} SOL to ${selected.label}...`)
    );

    try {
      const lamports = Math.round(parseFloat(amountStr) * LAMPORTS_PER_SOL);
      await transferSol(
        state.connection,
        state.superuser.keypair,
        selected.pubkey,
        lamports
      );
      const balance = await state.connection.getBalance(selected.pubkey);
      const solBalance = (balance / LAMPORTS_PER_SOL).toFixed(4);
      showSuccess(`Funded ${selected.label} with ${amountStr} SOL`);
      console.log(`  New balance: ${solBalance} SOL`);
    } catch (e) {
      showError(e);
    }
  } else {
    const amountStr = await input({
      message: "Amount (tokens):",
      default: state.randomMode ? state.rand.fundAmount() : "100",
    });

    console.log(
      chalk.dim(`\n  Minting ${amountStr} tokens to ${selected.label}...`)
    );

    try {
      const amount = parseTokenAmount(amountStr);
      const ata = await getOrCreateAta(
        state.connection,
        mint,
        selected.pubkey,
        state.superuser.keypair
      );
      await mintTokens(
        state.connection,
        mint,
        ata,
        state.superuser.keypair,
        BigInt(amount.toString())
      );
      const balance = await getTokenBalance(state.connection, ata);
      showSuccess(`Funded ${selected.label} with ${amountStr} tokens`);
      console.log(`  New balance: ${formatTokenAmount(balance)} tokens`);
    } catch (e) {
      showError(e);
    }
  }

  await pressKey();
}

module.exports = { addUser, assignRole, fundUser };
