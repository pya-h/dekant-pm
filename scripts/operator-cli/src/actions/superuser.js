const { input } = require("@inquirer/prompts");
const chalk = require("chalk");
const { pressKey, showError, showSuccess, printKV } = require("../ui");
const { airdropSol, LAMPORTS_PER_SOL } = require("../common");

// ─── Airdrop SOL to Superuser ───────────────────────────────────────────────

async function airdropSuperuser(state) {
  const pubkey = state.superuser.pubkey;

  console.log(chalk.dim(`\n  Superuser: ${pubkey.toBase58()}`));

  let currentBalance;
  try {
    currentBalance = await state.connection.getBalance(pubkey);
    console.log(
      chalk.dim(
        `  Current balance: ${(currentBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`
      )
    );
  } catch {
    // non-fatal, continue
  }

  const amountStr = await input({
    message: "Amount (SOL):",
    default: "10",
  });

  const lamports = Math.round(parseFloat(amountStr) * LAMPORTS_PER_SOL);
  if (isNaN(lamports) || lamports <= 0) {
    console.log(chalk.red("  Invalid amount."));
    await pressKey();
    return;
  }

  console.log(
    chalk.dim(`\n  Requesting airdrop of ${amountStr} SOL to superuser...`)
  );

  try {
    await airdropSol(state.connection, pubkey, lamports);
    const newBalance = await state.connection.getBalance(pubkey);
    showSuccess(`Airdropped ${amountStr} SOL to superuser`);
    printKV([
      ["Pubkey", pubkey.toBase58()],
      ["New Balance", `${(newBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`],
    ]);
  } catch (e) {
    showError(e);
  }

  await pressKey();
}

module.exports = { airdropSuperuser };
