const { select } = require("@inquirer/prompts");
const chalk = require("chalk");
const { pressKey } = require("../ui");
const {
  deriveAta,
  getTokenBalance,
  formatTokenAmount,
} = require("../common");

/**
 * @param {import('../state').SessionState} state
 * @param {object} [opts]
 * @param {boolean} [opts.includeSuperuser]
 * @param {boolean} [opts.includeCancel]
 * @param {string} [opts.message]
 * @param {import('@solana/web3.js').PublicKey} [opts.showBalanceForMint]
 * @returns {Promise<{keypair, label, pubkey}|"cancel"|null>}
 */
async function selectUser(state, opts) {
  opts = opts || {};
  if (state.users.length === 0 && !opts.includeSuperuser) {
    console.log(chalk.yellow("  No users available. Add a user first."));
    await pressKey();
    return null;
  }

  const choices = [];

  if (opts.includeSuperuser) {
    choices.push({
      name: `Superuser (${state.superuser.pubkey.toBase58().slice(0, 12)}...)`,
      value: {
        keypair: state.superuser.keypair,
        label: "Superuser",
        pubkey: state.superuser.pubkey,
      },
    });
  }

  for (const u of state.users) {
    let suffix = u.roles.length > 0 ? ` [${u.roles.join(", ")}]` : "";

    if (opts.showBalanceForMint) {
      try {
        const ata = deriveAta(opts.showBalanceForMint, u.pubkey);
        const bal = await getTokenBalance(state.connection, ata);
        suffix += chalk.dim(` (${formatTokenAmount(bal)} USDC)`);
      } catch {
        suffix += chalk.dim(" (0 USDC)");
      }
    }

    choices.push({
      name: `${u.label} (${u.pubkey.toBase58().slice(0, 12)}...)${suffix}`,
      value: { keypair: u.keypair, label: u.label, pubkey: u.pubkey },
    });
  }

  if (opts.includeCancel) {
    choices.push({ name: chalk.dim("Cancel"), value: "cancel" });
  }

  if (choices.length === 0) {
    console.log(chalk.yellow("  No users available."));
    await pressKey();
    return null;
  }

  return select({ message: opts.message || "Select user:", choices });
}

module.exports = { selectUser };
