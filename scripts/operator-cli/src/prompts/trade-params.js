const { select, input } = require("@inquirer/prompts");
const { outcomeLabel, MARKET_TYPE_CONTINUOUS } = require("../common");

/**
 * @param {import("../state").SessionState} state
 * @param {number} marketType
 * @param {"buy"|"sell"} action
 * @param {number} numOutcomes
 * @param {number} [rangeMin]
 * @param {number} [rangeMax]
 * @returns {Promise<{kind:"fixed"|"fixedByShares"|"fixedByCollateral",outcome:number,amount:string}|{kind:"toPrice",outcome:number,targetProbPct:number,limitAmount:string}|{kind:"distribution",mu:string,sigma:string,amount:string}>}
 */
async function collectTradeParams(
  state,
  marketType,
  action,
  numOutcomes,
  rangeMin,
  rangeMax
) {
  const rm = state.randomMode;
  const rand = state.rand;

  // Continuous markets: distribution trades
  if (marketType === MARKET_TYPE_CONTINUOUS) {
    const rangeStr =
      rangeMin !== undefined && rangeMax !== undefined
        ? ` (range: ${rangeMin}\u2013${rangeMax})`
        : "";

    const rMin = rangeMin || 0;
    const rMax = rangeMax || 1000;
    const mu = await input({
      message: `Mu (center value${rangeStr}):`,
      ...(rm && { default: rand.mu(rMin, rMax) }),
    });
    const sigma = await input({
      message: "Sigma (spread/std-dev):",
      ...(rm && { default: rand.sigma(rMin, rMax) }),
    });
    const amountLabel = action === "buy" ? "Amount (USDC) to buy" : "Token amount to sell";
    const amount = await input({
      message: `${amountLabel}:`,
      ...(rm && { default: rand.tradeAmount() }),
    });
    return { kind: "distribution", mu, sigma, amount };
  }

  // Discrete markets: choose trade type
  const actionLabel = action === "buy" ? "Buy" : "Sell";
  const inverseLabel = action === "buy" ? "by shares" : "by USDC";
  const subtype = await select({
    message: "Trade type:",
    choices: [
      { name: `${actionLabel} (fixed amount)`, value: "fixed" },
      { name: `${actionLabel} (${inverseLabel})`, value: "inverse" },
      { name: `${actionLabel} to Price (target probability)`, value: "toPrice" },
    ],
    ...(rm && { default: "fixed" }),
  });

  // Select outcome
  const outcomeChoices = Array.from({ length: numOutcomes }, (_, i) => ({
    name: outcomeLabel(marketType, i),
    value: i,
  }));
  const outcome = await select({
    message: "Select outcome:",
    choices: outcomeChoices,
    ...(rm && { default: rand.outcome(numOutcomes) }),
  });

  if (subtype === "inverse") {
    const amountLabel =
      action === "buy" ? "Number of shares to buy" : "USDC to receive";
    const amount = await input({
      message: `${amountLabel}:`,
      ...(rm && { default: rand.tradeAmount() }),
    });
    const kind = action === "buy" ? "fixedByShares" : "fixedByCollateral";
    return { kind, outcome, amount };
  } else if (subtype === "fixed") {
    const amountLabel = action === "buy" ? "Amount (USDC) to buy" : "Token amount to sell";
    const amount = await input({
      message: `${amountLabel}:`,
      ...(rm && { default: rand.tradeAmount() }),
    });
    return { kind: "fixed", outcome, amount };
  } else {
    const targetStr = await input({
      message: "Target probability (%):",
      ...(rm && { default: rand.targetProbability() }),
    });
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
