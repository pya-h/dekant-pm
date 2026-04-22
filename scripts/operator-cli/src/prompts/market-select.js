const { select } = require("@inquirer/prompts");
const chalk = require("chalk");
const { pressKey } = require("../ui");
const {
  findMarket,
  computeProbabilities,
  formatProbability,
  MARKET_TYPE_NAMES,
  MARKET_STATE_NAMES,
  MARKET_TYPE_BINARY,
} = require("../common");

/**
 * @param {import('../state').SessionState} state
 * @param {object} [opts]
 * @param {function} [opts.filter]
 * @param {string} [opts.message]
 * @param {boolean} [opts.includeCancel]
 * @returns {Promise<import('../state').SessionMarket|"cancel"|null>}
 */
async function selectMarket(state, opts) {
  opts = opts || {};
  let markets = state.markets;
  if (opts.filter) {
    markets = markets.filter(opts.filter);
  }

  if (markets.length === 0) {
    console.log(
      chalk.yellow("  No markets available. Create a market first.")
    );
    await pressKey();
    return null;
  }

  const choices = [];

  for (const m of markets) {
    let probStr = "";
    try {
      const [marketPda] = findMarket(m.id, state.programId);
      const market = await state.superProgram.account.market.fetch(marketPda);
      const probs = computeProbabilities(market.reserves, market.totalMinted);
      const stateStr = MARKET_STATE_NAMES[market.state] || "Unknown";

      if (m.type === MARKET_TYPE_BINARY) {
        probStr = `Y:${formatProbability(probs[0])} N:${formatProbability(probs[1])}`;
      } else {
        probStr = `${m.numOutcomes} outcomes`;
      }

      choices.push({
        name: `#${m.id} ${m.label} (${MARKET_TYPE_NAMES[m.type]}, ${stateStr}) ${chalk.dim(probStr)}`,
        value: m,
      });
    } catch {
      choices.push({
        name: `#${m.id} ${m.label} (${MARKET_TYPE_NAMES[m.type]})`,
        value: m,
      });
    }
  }

  if (opts.includeCancel) {
    choices.push({ name: chalk.dim("Cancel"), value: "cancel" });
  }

  return select({ message: opts.message || "Select market:", choices });
}

module.exports = { selectMarket };
