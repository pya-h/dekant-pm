const chalk = require("chalk");
const { ComputeBudgetProgram } = require("@solana/web3.js");
const {
  clear,
  pressKey,
  showError,
  showSuccess,
  printProbabilities,
  printBeforeAfter,
} = require("../ui");
const { selectUser } = require("../prompts/user-select");
const { selectMarket } = require("../prompts/market-select");
const { collectTradeParams } = require("../prompts/trade-params");
const {
  BN,
  SystemProgram,
  findProtocolConfig,
  findMarket,
  findVaultAuthority,
  findUserPosition,
  getOrCreateAta,
  getTokenBalance,
  parseTokenAmount,
  formatTokenAmount,
  SCALE,
  MARKET_TYPE_NAMES,
  MARKET_STATE_NAMES,
  TOKEN_PROGRAM_ID,
} = require("../common");
const {
  findCollateralForShares,
  findTokensForCollateral,
  toBigInts,
} = require("../amm");

async function buyOutcome(state) {
  await executeTrade(state, "buy");
}

async function sellOutcome(state) {
  await executeTrade(state, "sell");
}

async function executeTrade(state, action) {
  // Step 1: select market
  const sm = await selectMarket(state, {
    message: `Select market to ${action}:`,
  });
  if (!sm || sm === "cancel") return;

  // Step 2: show detail
  const [marketPda] = findMarket(sm.id, state.programId);
  const marketData = await state.superProgram.account.market.fetch(marketPda);

  clear();
  console.log(
    chalk.bold(
      `\n  ${action === "buy" ? "Buy" : "Sell"} \u2014 Market #${sm.id}: ${sm.label}`
    )
  );
  console.log(
    `  Type: ${MARKET_TYPE_NAMES[sm.type]}  |  State: ${MARKET_STATE_NAMES[marketData.state]}`
  );
  console.log();
  printProbabilities(sm.type, marketData.reserves, marketData.totalMinted);
  console.log();

  // Step 3: params
  const params = await collectTradeParams(
    state,
    sm.type,
    action,
    sm.numOutcomes,
    sm.rangeMin,
    sm.rangeMax
  );

  // Step 4: select user
  const user = await selectUser(state, {
    message: `${action === "buy" ? "Buy" : "Sell"} as:`,
    includeSuperuser: true,
    includeCancel: true,
    showBalanceForMint: sm.mint,
  });
  if (!user || user === "cancel") return;

  // Step 5: execute
  try {
    const program = state.programForUser(user.keypair);
    const [protocolConfig] = findProtocolConfig(state.programId);
    const [vaultAuthority] = findVaultAuthority(marketPda, state.programId);
    const [userPosition] = findUserPosition(
      marketPda,
      user.pubkey,
      state.programId
    );
    const traderAta = await getOrCreateAta(
      state.connection,
      marketData.collateralMint,
      user.pubkey,
      state.superuser.keypair
    );

    const balanceBefore = await getTokenBalance(state.connection, traderAta);

    const baseAccounts = {
      trader: user.pubkey,
      market: marketPda,
      protocolConfig,
      userPosition,
      vaultAuthority,
      vault: marketData.vault,
      traderAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    };

    if (params.kind === "distribution") {
      await doDistributionTrade(program, action, baseAccounts, params);
    } else if (params.kind === "toPrice") {
      await doToPriceTrade(program, action, baseAccounts, params);
    } else if (params.kind === "fixedByShares" || params.kind === "fixedByCollateral") {
      await doInverseTrade(state, program, action, baseAccounts, params, marketData);
    } else {
      await doFixedTrade(program, action, baseAccounts, params);
    }

    const balanceAfter = await getTokenBalance(state.connection, traderAta);
    const newMarketData = await state.superProgram.account.market.fetch(
      marketPda
    );

    const diff =
      action === "buy"
        ? balanceBefore - balanceAfter
        : balanceAfter - balanceBefore;

    showSuccess(
      action === "buy"
        ? `Spent ${formatTokenAmount(diff)} USDC`
        : `Received ${formatTokenAmount(diff)} USDC`
    );
    console.log(
      `  Balance: ${formatTokenAmount(balanceBefore)} -> ${formatTokenAmount(balanceAfter)} USDC`
    );

    printBeforeAfter(
      sm.type,
      marketData.reserves,
      marketData.totalMinted,
      newMarketData.reserves,
      newMarketData.totalMinted
    );
  } catch (e) {
    showError(e);
  }

  await pressKey();
}

async function doFixedTrade(program, action, accounts, params) {
  const amount = parseTokenAmount(params.amount);
  if (action === "buy") {
    await program.methods
      .buy({ outcome: params.outcome, collateralAmount: amount })
      .accountsPartial({ ...accounts, systemProgram: SystemProgram.programId })
      .rpc();
  } else {
    await program.methods
      .sell({ outcome: params.outcome, tokenAmount: amount })
      .accountsPartial(accounts)
      .rpc();
  }
}

async function doToPriceTrade(program, action, accounts, params) {
  const targetProbability = new BN(
    Math.floor(
      (params.targetProbPct * Number(SCALE.toString())) / 100
    )
  );
  if (action === "buy") {
    const maxCollateral = parseTokenAmount(params.limitAmount);
    await program.methods
      .buyToPrice({
        outcome: params.outcome,
        targetProbability,
        maxCollateral,
      })
      .accountsPartial({ ...accounts, systemProgram: SystemProgram.programId })
      .rpc();
  } else {
    const minCollateralOut = parseTokenAmount(params.limitAmount);
    await program.methods
      .sellToPrice({
        outcome: params.outcome,
        targetProbability,
        minCollateralOut,
      })
      .accountsPartial(accounts)
      .rpc();
  }
}

async function doDistributionTrade(program, action, accounts, params) {
  const mu = new BN(Math.round(parseFloat(params.mu) * 1e9).toString());
  const sigma = new BN(Math.round(parseFloat(params.sigma) * 1e9).toString());
  const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: 1_000_000,
  });

  if (action === "buy") {
    const collateralAmount = parseTokenAmount(params.amount);
    await program.methods
      .buyDistribution({ mu, sigma, collateralAmount })
      .accountsPartial({ ...accounts, systemProgram: SystemProgram.programId })
      .preInstructions([computeIx])
      .rpc();
  } else {
    const tokenAmount = parseTokenAmount(params.amount);
    await program.methods
      .sellDistribution({ mu, sigma, tokenAmount })
      .accountsPartial(accounts)
      .preInstructions([computeIx])
      .rpc();
  }
}

async function doInverseTrade(state, program, action, accounts, params, marketData) {
  const [protocolConfig] = findProtocolConfig(state.programId);
  const config = await state.superProgram.account.protocolConfig.fetch(protocolConfig);
  const tradeFeeBps = config.tradeFeeBps;
  const { reserves, totalMinted } = toBigInts(marketData);

  if (action === "buy" && params.kind === "fixedByShares") {
    // User wants to buy a specific number of shares
    const targetShares = BigInt(parseTokenAmount(params.amount).toString());
    const grossCollateral = findCollateralForShares(
      reserves, totalMinted, params.outcome, targetShares, tradeFeeBps
    );
    console.log(
      chalk.dim(`  Computed collateral needed: ${formatTokenAmount(grossCollateral)} USDC`)
    );
    await program.methods
      .buy({ outcome: params.outcome, collateralAmount: new BN(grossCollateral.toString()) })
      .accountsPartial({ ...accounts, systemProgram: SystemProgram.programId })
      .rpc();
  } else {
    // User wants to sell shares to receive a specific USDC amount
    const targetCollateral = BigInt(parseTokenAmount(params.amount).toString());
    const tokensToSell = findTokensForCollateral(
      reserves, totalMinted, params.outcome, targetCollateral, tradeFeeBps
    );
    console.log(
      chalk.dim(`  Computed shares to sell: ${formatTokenAmount(tokensToSell)}`)
    );
    await program.methods
      .sell({ outcome: params.outcome, tokenAmount: new BN(tokensToSell.toString()) })
      .accountsPartial(accounts)
      .rpc();
  }
}

module.exports = { buyOutcome, sellOutcome };
