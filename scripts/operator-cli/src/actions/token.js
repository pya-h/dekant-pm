const { input } = require("@inquirer/prompts");
const chalk = require("chalk");
const { createMint } = require("@solana/spl-token");
const { pressKey, showError, showSuccess, printKV } = require("../ui");
const {
  getOrCreateAta,
  mintTokens,
  getTokenBalance,
  formatTokenAmount,
  parseTokenAmount,
} = require("../common");

// ─── Create SPL Token ───────────────────────────────────────────────────────

async function createSplToken(state) {
  console.log(chalk.cyan.bold("\n  Create SPL Token\n"));
  console.log(
    chalk.dim(`  Superuser (mint authority): ${state.superuser.pubkey.toBase58()}`)
  );

  const name = await input({
    message: "Token name (for display):",
    default: `Token-${Date.now().toString(36)}`,
  });

  const decimalsStr = await input({
    message: "Decimals:",
    default: "6",
  });
  const decimals = parseInt(decimalsStr);
  if (isNaN(decimals) || decimals < 0 || decimals > 18) {
    console.log(chalk.red("  Invalid decimals (must be 0-18)."));
    await pressKey();
    return;
  }

  console.log(chalk.dim("\n  Creating mint on-chain..."));

  try {
    const mint = await createMint(
      state.connection,
      state.superuser.keypair,
      state.superuser.keypair.publicKey,
      null,
      decimals
    );

    console.log(chalk.green(`  Mint created: ${mint.toBase58()}`));

    const supplyStr = await input({
      message: "Initial supply to mint to superuser:",
      default: "1000000",
    });

    const supply = parseTokenAmount(supplyStr, decimals);
    if (!supply || supply.isZero() || supply.isNeg()) {
      console.log(chalk.red("  Invalid supply amount."));
      await pressKey();
      return;
    }

    console.log(chalk.dim(`\n  Minting ${supplyStr} ${name} to superuser...`));

    const ata = await getOrCreateAta(
      state.connection,
      mint,
      state.superuser.pubkey,
      state.superuser.keypair
    );
    await mintTokens(
      state.connection,
      mint,
      ata,
      state.superuser.keypair,
      BigInt(supply.toString())
    );

    const balance = await getTokenBalance(state.connection, ata);

    showSuccess(`Created SPL token "${name}"`);
    printKV([
      ["Name", name],
      ["Mint", mint.toBase58()],
      ["Decimals", decimals.toString()],
      ["Minted to Superuser", formatTokenAmount(supply, decimals)],
      ["Balance", formatTokenAmount(balance, decimals)],
    ]);
  } catch (e) {
    showError(e);
  }

  await pressKey();
}

module.exports = { createSplToken };
