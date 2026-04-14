const { select, input } = require("@inquirer/prompts");
const chalk = require("chalk");
const { pressKey, showError, showSuccess, showInfo, printKV } = require("../ui");
const { selectUser } = require("../prompts/user-select");
const { selectMarket } = require("../prompts/market-select");
const {
  BN,
  findProtocolConfig,
  findMarket,
  findVaultAuthority,
  findUserPosition,
  getOrCreateAta,
  getTokenBalance,
  formatTokenAmount,
  formatTimestamp,
  outcomeLabel,
  SCALE,
  MARKET_TYPE_CONTINUOUS,
  MARKET_STATE_NAMES,
  TOKEN_PROGRAM_ID,
} = require("../common");

// ─── Resolve Market ──────────────────────────────────────────────────────────

async function resolveMarket(state) {
  const sm = await selectMarket(state, {
    message: "Select market to resolve:",
  });
  if (!sm || sm === "cancel") return;

  const [marketPda] = findMarket(sm.id, state.programId);

  // Resolution params
  let outcome, value;

  if (sm.type === MARKET_TYPE_CONTINUOUS) {
    const valueStr = await input({
      message: `Resolved value (range: ${sm.rangeMin}\u2013${sm.rangeMax}):`,
      ...(state.randomMode && {
        default: state.rand.resolveValue(sm.rangeMin, sm.rangeMax),
      }),
    });
    value = new BN(Math.round(parseFloat(valueStr) * 1e9).toString());
    outcome = 0;
    console.log(chalk.dim(`\n  Resolving with value: ${valueStr}`));
  } else {
    const outcomeChoices = Array.from({ length: sm.numOutcomes }, (_, i) => ({
      name: outcomeLabel(sm.type, i),
      value: i,
    }));
    outcome = await select({
      message: "Winning outcome:",
      choices: outcomeChoices,
      ...(state.randomMode && {
        default: state.rand.resolveOutcome(sm.numOutcomes),
      }),
    });
    value = new BN(0);
    console.log(
      chalk.dim(
        `\n  Resolving with winner: ${outcomeLabel(sm.type, outcome)}`
      )
    );
  }

  // User selection with retry
  let done = false;
  while (!done) {
    const user = await selectUser(state, {
      message: "Resolve as (must be oracle):",
      includeSuperuser: true,
      includeCancel: true,
    });
    if (!user || user === "cancel") return;

    try {
      const program = state.programForUser(user.keypair);

      await program.methods
        .resolveMarket({ outcome, value })
        .accountsPartial({ oracle: user.pubkey, market: marketPda })
        .rpc();

      const resolved = await state.superProgram.account.market.fetch(marketPda);

      showSuccess(`Market #${sm.id} resolved!`);
      printKV([
        ["State", MARKET_STATE_NAMES[resolved.state]],
        [
          "Resolved outcome",
          outcomeLabel(sm.type, resolved.resolvedOutcome),
        ],
        ["Resolved at", formatTimestamp(resolved.resolvedAt.toNumber())],
        ...(sm.type === MARKET_TYPE_CONTINUOUS
          ? [
              [
                "Resolved value",
                (
                  Number(resolved.resolvedValue.toString()) /
                  Number(SCALE.toString())
                ).toString(),
              ],
            ]
          : []),
      ]);
      done = true;
    } catch (e) {
      showError(e);
      console.log(chalk.dim("  Select a different user or Cancel."));
    }
  }

  await pressKey();
}

// ─── Claim Payout ────────────────────────────────────────────────────────────

async function claimPayout(state) {
  const sm = await selectMarket(state, {
    message: "Select resolved market to claim from:",
  });
  if (!sm || sm === "cancel") return;

  const [marketPda] = findMarket(sm.id, state.programId);
  const marketData = await state.superProgram.account.market.fetch(marketPda);

  if (marketData.state !== 3) {
    console.log(
      chalk.yellow(
        `  Market is not resolved (state: ${MARKET_STATE_NAMES[marketData.state]})`
      )
    );
    await pressKey();
    return;
  }

  console.log(
    chalk.dim(
      `  Winner: ${outcomeLabel(sm.type, marketData.resolvedOutcome)}`
    )
  );

  const user = await selectUser(state, {
    message: "Claim as:",
    includeSuperuser: true,
    includeCancel: true,
  });
  if (!user || user === "cancel") return;

  try {
    const program = state.programForUser(user.keypair);
    const [protocolConfig] = findProtocolConfig(state.programId);
    const [vaultAuthority] = findVaultAuthority(marketPda, state.programId);
    const [userPosition] = findUserPosition(
      marketPda,
      user.pubkey,
      state.programId
    );

    let position;
    try {
      position = await program.account.userPosition.fetch(userPosition);
    } catch {
      console.log(chalk.yellow("  No position found for this user."));
      await pressKey();
      return;
    }

    if (position.claimed) {
      console.log(chalk.yellow("  Already claimed!"));
      await pressKey();
      return;
    }

    // Show holdings
    console.log(chalk.dim("\n  Holdings:"));
    for (let i = 0; i < position.holdings.length; i++) {
      const h = position.holdings[i];
      if (h.toNumber() > 0) {
        const label = outcomeLabel(sm.type, i);
        const isWinner = i === marketData.resolvedOutcome;
        console.log(
          `    ${label.padEnd(12)} ${h.toString()}${isWinner ? chalk.green(" (winner)") : ""}`
        );
      }
    }

    const traderAta = await getOrCreateAta(
      state.connection,
      marketData.collateralMint,
      user.pubkey,
      state.superuser.keypair
    );
    const balanceBefore = await getTokenBalance(state.connection, traderAta);

    await program.methods
      .claimPayout()
      .accountsPartial({
        trader: user.pubkey,
        market: marketPda,
        protocolConfig,
        userPosition,
        vaultAuthority,
        vault: marketData.vault,
        traderAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const balanceAfter = await getTokenBalance(state.connection, traderAta);

    showSuccess("Payout claimed!");
    console.log(
      `  Net payout: ${formatTokenAmount(balanceAfter - balanceBefore)} USDC`
    );
    console.log(
      `  Balance: ${formatTokenAmount(balanceBefore)} -> ${formatTokenAmount(balanceAfter)} USDC`
    );
  } catch (e) {
    showError(e);
  }

  await pressKey();
}

// ─── Collect Fees ────────────────────────────────────────────────────────────

async function collectFees(state) {
  const sm = await selectMarket(state, {
    message: "Select market to collect fees from:",
  });
  if (!sm || sm === "cancel") return;

  const [marketPda] = findMarket(sm.id, state.programId);
  const marketData = await state.superProgram.account.market.fetch(marketPda);
  const [protocolConfig] = findProtocolConfig(state.programId);
  const config = await state.superProgram.account.protocolConfig.fetch(
    protocolConfig
  );
  const [vaultAuthority] = findVaultAuthority(marketPda, state.programId);

  console.log(
    `  Protocol fees accumulated: ${formatTokenAmount(marketData.protocolFeeAccumulated)} USDC`
  );

  if (marketData.protocolFeeAccumulated.toNumber() === 0) {
    console.log(chalk.yellow("  No fees to collect."));
    await pressKey();
    return;
  }

  try {
    const treasuryAta = await getOrCreateAta(
      state.connection,
      marketData.collateralMint,
      config.treasury,
      state.superuser.keypair
    );

    showInfo("Collecting fees (superuser)...");

    await state.superProgram.methods
      .collectFees()
      .accountsPartial({
        authority: state.superuser.pubkey,
        protocolConfig,
        market: marketPda,
        vaultAuthority,
        vault: marketData.vault,
        treasuryAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    showSuccess(
      `Collected ${formatTokenAmount(marketData.protocolFeeAccumulated)} USDC fees!`
    );
  } catch (e) {
    showError(e);
  }

  await pressKey();
}

module.exports = { resolveMarket, claimPayout, collectFees };
