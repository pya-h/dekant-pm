const chalk = require("chalk");
const asciichart = require("asciichart");
const { pressKey, printKV, printProbabilities } = require("../ui");
const { selectUser } = require("../prompts/user-select");
const { selectMarket } = require("../prompts/market-select");
const {
  findMarket,
  findUserPosition,
  getTokenBalance,
  computeProbabilities,
  formatTokenAmount,
  formatTimestamp,
  outcomeLabel,
  SCALE,
  MARKET_TYPE_CONTINUOUS,
  MARKET_TYPE_NAMES,
  MARKET_STATE_NAMES,
} = require("../common");

async function queryMarketInfo(state) {
  const sm = await selectMarket(state, {
    message: "Select market to inspect:",
  });
  if (!sm || sm === "cancel") return;

  const [marketPda] = findMarket(sm.id, state.programId);
  const market = await state.superProgram.account.market.fetch(marketPda);
  const vaultBalance = await getTokenBalance(state.connection, market.vault);
  const probs = computeProbabilities(market.reserves, market.totalMinted);

  console.log(chalk.bold(`\n  Market #${sm.id}: ${sm.label}`));
  console.log();

  printKV([
    ["PDA", marketPda.toBase58()],
    ["Type", MARKET_TYPE_NAMES[market.marketType] || `Unknown(${market.marketType})`],
    ["State", MARKET_STATE_NAMES[market.state] || `Unknown(${market.state})`],
    ["Creator", market.creator.toBase58()],
    ["Oracle", market.oracle.toBase58()],
    ["Collateral mint", market.collateralMint.toBase58()],
    ["Vault balance", `${formatTokenAmount(vaultBalance)} USDC`],
    ["Deadline", formatTimestamp(market.deadline.toNumber())],
    ["Created", formatTimestamp(market.createdAt.toNumber())],
    ["Outcomes/bins", market.numOutcomes.toString()],
    ["Total minted", market.totalMinted.toString()],
    ["LP shares total", market.lpSharesTotal.toString()],
    ["LP fee accumulated", formatTokenAmount(market.lpFeeAccumulated)],
    ["Protocol fee", formatTokenAmount(market.protocolFeeAccumulated)],
  ]);

  if (market.marketType === MARKET_TYPE_CONTINUOUS) {
    const rangeMin =
      Number(market.rangeMin.toString()) / Number(SCALE.toString());
    const rangeMax =
      Number(market.rangeMax.toString()) / Number(SCALE.toString());
    console.log(`\n  Range: [${rangeMin}, ${rangeMax}]`);
  }

  if (market.state === 3) {
    console.log(chalk.green("\n  Resolved:"));
    printKV([
      ["Winner", outcomeLabel(market.marketType, market.resolvedOutcome)],
      ["Resolved at", formatTimestamp(market.resolvedAt.toNumber())],
    ]);
    if (market.marketType === MARKET_TYPE_CONTINUOUS) {
      const resolvedVal =
        Number(market.resolvedValue.toString()) / Number(SCALE.toString());
      printKV([["Resolved value", resolvedVal.toString()]]);
    }
  }

  console.log(chalk.dim("\n  Probabilities:"));
  printProbabilities(
    market.marketType,
    market.reserves,
    market.totalMinted,
    market.state === 3 ? market.resolvedOutcome : undefined
  );

  // ASCII chart for continuous markets
  if (market.marketType === MARKET_TYPE_CONTINUOUS && probs.length > 2) {
    try {
      const chartData = probs.map((p) => p * 100);
      console.log(chalk.dim("\n  Probability distribution (%):\n"));
      console.log(
        asciichart.plot(chartData, {
          height: 12,
          padding: "    ",
          format: (x) => x.toFixed(1).padStart(6),
        })
      );
    } catch {
      // asciichart edge case, not critical
    }
  }

  await pressKey();
}

async function viewPosition(state) {
  const sm = await selectMarket(state, { message: "Select market:" });
  if (!sm || sm === "cancel") return;

  const user = await selectUser(state, {
    message: "View position for:",
    includeSuperuser: true,
    includeCancel: true,
  });
  if (!user || user === "cancel") return;

  const [marketPda] = findMarket(sm.id, state.programId);
  const [userPosition] = findUserPosition(
    marketPda,
    user.pubkey,
    state.programId
  );

  try {
    const position = await state.superProgram.account.userPosition.fetch(
      userPosition
    );
    const market = await state.superProgram.account.market.fetch(marketPda);

    console.log(
      chalk.bold(`\n  ${user.label}'s position in Market #${sm.id}:`)
    );
    console.log();

    printKV([
      ["Total deposited", `${formatTokenAmount(position.totalDeposited)} USDC`],
      [
        "Total withdrawn",
        `${formatTokenAmount(position.totalWithdrawn)} USDC`,
      ],
      ["Claimed", position.claimed ? "Yes" : "No"],
    ]);

    console.log(chalk.dim("\n  Holdings:"));
    let hasHoldings = false;
    for (let i = 0; i < position.holdings.length; i++) {
      const h = position.holdings[i];
      if (h.toNumber() > 0) {
        hasHoldings = true;
        const label = outcomeLabel(market.marketType, i);
        const isWinner = market.state === 3 && i === market.resolvedOutcome;
        console.log(
          `    ${label.padEnd(12)} ${h.toString()}${isWinner ? chalk.green(" (winner)") : ""}`
        );
      }
    }
    if (!hasHoldings) {
      console.log(chalk.dim("    (no holdings)"));
    }
  } catch {
    console.log(chalk.yellow("  No position found."));
  }

  await pressKey();
}

module.exports = { queryMarketInfo, viewPosition };
