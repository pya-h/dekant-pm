const { select, input } = require("@inquirer/prompts");
const { outcomeLabel, MARKET_TYPE_CONTINUOUS } = require("../common");

/**
 * @param {number} marketType
 * @param {"buy"|"sell"} action
 * @param {number} numOutcomes
 * @param {number} [rangeMin]
 * @param {number} [rangeMax]
 * @returns {Promise<{kind:"fixed",outcome:number,amount:string}|{kind:"toPrice",outcome:number,targetProbPct:number,limitAmount:string}|{kind:"distribution",mu:string,sigma:string,amount:string}>}
 */
async function collectTradeParams(
  marketType,
  action,
  numOutcomes,
  rangeMin,
  rangeMax
) {
  // Continuous markets: distribution trades
  if (marketType === MARKET_TYPE_CONTINUOUS) {
    const rangeStr =
      rangeMin !== undefined && rangeMax !== undefined
        ? ` (range: ${rangeMin}\u2013${rangeMax})`
        : "";

    const mu = await input({ message: `Mu (center value${rangeStr}):` });
    const sigma = await input({ message: "Sigma (spread/std-dev):" });
    const amountLabel = action === "buy" ? "Amount (USDC) to buy" : "Token amount to sell";
    const amount = await input({ message: `${amountLabel}:` });
    return { kind: "distribution", mu, sigma, amount };
  }

  // Discrete markets: choose trade type
  const actionLabel = action === "buy" ? "Buy" : "Sell";
  const subtype = await select({
    message: "Trade type:",
    choices: [
      { name: `${actionLabel} (fixed amount)`, value: "fixed" },
      { name: `${actionLabel} to Price (target probability)`, value: "toPrice" },
    ],
  });

  // Select outcome
  const outcomeChoices = Array.from({ length: numOutcomes }, (_, i) => ({
    name: outcomeLabel(marketType, i),
    value: i,
  }));
  const outcome = await select({
    message: "Select outcome:",
    choices: outcomeChoices,
  });

  if (subtype === "fixed") {
    const amountLabel = action === "buy" ? "Amount (USDC) to buy" : "Token amount to sell";
    const amount = await input({ message: `${amountLabel}:` });
    return { kind: "fixed", outcome, amount };
  } else {
    const targetStr = await input({ message: "Target probability (%):" });
    const targetProbPct = parseFloat(targetStr);
    const limitAmount = await input({
      message:
        action === "buy"
          ? "Max collateral (default 1000):"
          : "Min collateral out (default 0):",
      default: action === "buy" ? "1000" : "0",
    });
    return { kind: "toPrice", outcome, targetProbPct, limitAmount };
  }
}

module.exports = { collectTradeParams };
