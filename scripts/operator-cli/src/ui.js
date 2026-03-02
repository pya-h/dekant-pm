const chalk = require("chalk");
const { input } = require("@inquirer/prompts");
const {
  MARKET_TYPE_NAMES,
  MARKET_STATE_NAMES,
  formatProbability,
  computeProbabilities,
  outcomeLabel,
  formatTokenAmount,
} = require("./common");

// ─── Screen ──────────────────────────────────────────────────────────────────

function clear() {
  process.stdout.write("\x1b[2J\x1b[H");
}

function banner(state) {
  const line = "\u2500".repeat(42);
  console.log(chalk.cyan(line));
  console.log(chalk.cyan.bold("  DekantPM Tester CLI"));
  console.log(
    chalk.dim(
      `  Superuser: ${state.superuser.pubkey.toBase58().slice(0, 16)}...`
    )
  );
  console.log(
    chalk.dim(
      `  Users: ${state.users.length}  |  Markets: ${state.markets.length}`
    )
  );
  console.log(chalk.cyan(line));
  console.log();
}

// ─── Press Key ───────────────────────────────────────────────────────────────

async function pressKey(msg) {
  await input({ message: msg || "Press Enter to continue..." });
}

// ─── Error Formatting ────────────────────────────────────────────────────────

function extractAnchorError(e) {
  if (e.error && e.error.errorMessage) return e.error.errorMessage;
  if (e.logs) {
    const errorLog = e.logs.find((l) => l.includes("Error Message:"));
    if (errorLog) return errorLog.split("Error Message:")[1].trim();
  }
  const msg = e.message || e.toString();
  return msg.length > 150 ? msg.slice(0, 150) + "..." : msg;
}

function showError(e) {
  console.log(chalk.red(`\n  Error: ${extractAnchorError(e)}`));
}

function showSuccess(msg) {
  console.log(chalk.green(`\n  ${msg}`));
}

function showInfo(msg) {
  console.log(chalk.dim(`  ${msg}`));
}

// ─── Probability Display ─────────────────────────────────────────────────────

function probBar(prob, width) {
  const w = width || 20;
  const filled = Math.round(prob * w);
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(w - filled);
  return `${bar} ${formatProbability(prob)}`;
}

function printProbabilities(marketType, reserves, totalMinted, highlight) {
  const probs = computeProbabilities(reserves, totalMinted);
  const maxDisplay = probs.length <= 10 ? probs.length : 32;

  for (let i = 0; i < Math.min(probs.length, maxDisplay); i++) {
    if (probs.length > 10 && probs[i] < 0.001) continue;
    const label = outcomeLabel(marketType, i);
    const marker =
      highlight !== undefined && i === highlight ? chalk.yellow(" \u25C4") : "";
    console.log(`    ${label.padEnd(12)} ${probBar(probs[i])}${marker}`);
  }
  if (probs.length > maxDisplay) {
    console.log(
      chalk.dim(`    ... (${probs.length - maxDisplay} more bins)`)
    );
  }
}

function printBeforeAfter(
  marketType,
  oldReserves,
  oldTotalMinted,
  newReserves,
  newTotalMinted
) {
  const probsBefore = computeProbabilities(oldReserves, oldTotalMinted);
  const probsAfter = computeProbabilities(newReserves, newTotalMinted);
  const maxDisplay = probsBefore.length <= 10 ? probsBefore.length : 32;

  console.log(chalk.dim("\n  Probability changes:"));
  for (let i = 0; i < Math.min(probsBefore.length, maxDisplay); i++) {
    if (
      probsBefore.length > 10 &&
      Math.abs(probsAfter[i] - probsBefore[i]) < 0.0001 &&
      probsBefore[i] < 0.001
    )
      continue;
    const label = outcomeLabel(marketType, i);
    console.log(
      `    ${label.padEnd(12)} ${formatProbability(probsBefore[i]).padStart(8)} -> ${formatProbability(probsAfter[i]).padStart(8)}`
    );
  }
  if (probsBefore.length > maxDisplay) {
    console.log(
      chalk.dim(`    ... (${probsBefore.length - maxDisplay} more bins)`)
    );
  }
}

// ─── Table ───────────────────────────────────────────────────────────────────

function printKV(rows) {
  const maxKey = Math.max(...rows.map(([k]) => k.length));
  for (const [key, value] of rows) {
    console.log(`  ${chalk.dim(key.padEnd(maxKey))}  ${value}`);
  }
}

module.exports = {
  clear,
  banner,
  pressKey,
  extractAnchorError,
  showError,
  showSuccess,
  showInfo,
  probBar,
  printProbabilities,
  printBeforeAfter,
  printKV,
};
