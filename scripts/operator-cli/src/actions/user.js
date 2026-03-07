const { select, input } = require("@inquirer/prompts");
const chalk = require("chalk");
const { pressKey, showError, showSuccess, showInfo, printKV } = require("../ui");
const { selectUser } = require("../prompts/user-select");
const { selectMarket } = require("../prompts/market-select");
const {
  Keypair,
  SystemProgram,
  airdropSol,
  getOrCreateAta,
  mintTokens,
  getTokenBalance,
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

  if (state.markets.length === 0) {
    console.log(
      chalk.yellow(
        "  No markets available. Create a market first (needed for collateral mint)."
      )
    );
    await pressKey();
    return;
  }

  const selected = await selectUser(state, {
    message: "Select user to fund:",
  });
  if (!selected || selected === "cancel") return;

  const market = await selectMarket(state, {
    message: "Select market (for collateral mint):",
  });
  if (!market || market === "cancel") return;

  const amountStr = await input({
    message: "Amount (USDC):",
    default: state.randomMode ? state.rand.fundAmount() : "100",
  });

  console.log(
    chalk.dim(`\n  Minting ${amountStr} USDC to ${selected.label}...`)
  );

  try {
    const amount = parseTokenAmount(amountStr);
    const ata = await getOrCreateAta(
      state.connection,
      market.mint,
      selected.pubkey,
      state.superuser.keypair
    );
    await mintTokens(
      state.connection,
      market.mint,
      ata,
      state.superuser.keypair,
      BigInt(amount.toString())
    );

    const balance = await getTokenBalance(state.connection, ata);
    showSuccess(`Funded ${selected.label} with ${amountStr} USDC`);
    console.log(`  New balance: ${formatTokenAmount(balance)} USDC`);
  } catch (e) {
    showError(e);
  }

  await pressKey();
}

module.exports = { addUser, assignRole, fundUser };
