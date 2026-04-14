const { input } = require("@inquirer/prompts");
const chalk = require("chalk");
const { pressKey, showError, showSuccess, printKV } = require("../ui");
const { selectUser } = require("../prompts/user-select");
const { selectMarket } = require("../prompts/market-select");
const {
  BN,
  SystemProgram,
  findMarket,
  findVaultAuthority,
  findLpPosition,
  getOrCreateAta,
  getTokenBalance,
  parseTokenAmount,
  formatTokenAmount,
  TOKEN_PROGRAM_ID,
} = require("../common");

async function addLiquidity(state) {
  const sm = await selectMarket(state, {
    message: "Select market to add liquidity:",
  });
  if (!sm || sm === "cancel") return;

  const amountStr = await input({
    message: "Amount (USDC) to add:",
    default: state.randomMode ? state.rand.liquidity() : "50",
  });

  const user = await selectUser(state, {
    message: "Add liquidity as:",
    includeSuperuser: true,
    includeCancel: true,
    showBalanceForMint: sm.mint,
  });
  if (!user || user === "cancel") return;

  try {
    const program = state.programForUser(user.keypair);
    const [marketPda] = findMarket(sm.id, state.programId);
    const [vaultAuthority] = findVaultAuthority(marketPda, state.programId);
    const [lpPosition] = findLpPosition(
      marketPda,
      user.pubkey,
      state.programId
    );
    const marketData = await program.account.market.fetch(marketPda);

    const providerAta = await getOrCreateAta(
      state.connection,
      marketData.collateralMint,
      user.pubkey,
      state.superuser.keypair
    );

    const amount = parseTokenAmount(amountStr);

    await program.methods
      .addLiquidity({ amount })
      .accountsPartial({
        provider: user.pubkey,
        market: marketPda,
        lpPosition,
        vaultAuthority,
        vault: marketData.vault,
        providerAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    showSuccess(`Added ${amountStr} USDC liquidity to Market #${sm.id}`);

    try {
      const lp = await program.account.lpPosition.fetch(lpPosition);
      printKV([
        ["LP shares", lp.shares.toString()],
        ["Deposited", formatTokenAmount(lp.depositedCollateral)],
      ]);
    } catch {}
  } catch (e) {
    showError(e);
  }

  await pressKey();
}

async function removeLiquidity(state) {
  const sm = await selectMarket(state, {
    message: "Select market to remove liquidity:",
  });
  if (!sm || sm === "cancel") return;

  const user = await selectUser(state, {
    message: "Remove liquidity as:",
    includeSuperuser: true,
    includeCancel: true,
  });
  if (!user || user === "cancel") return;

  try {
    const program = state.programForUser(user.keypair);
    const [marketPda] = findMarket(sm.id, state.programId);
    const [vaultAuthority] = findVaultAuthority(marketPda, state.programId);
    const [lpPosition] = findLpPosition(
      marketPda,
      user.pubkey,
      state.programId
    );
    const marketData = await program.account.market.fetch(marketPda);

    const providerAta = await getOrCreateAta(
      state.connection,
      marketData.collateralMint,
      user.pubkey,
      state.superuser.keypair
    );

    let lp;
    try {
      lp = await program.account.lpPosition.fetch(lpPosition);
    } catch {
      console.log(
        chalk.yellow("  No LP position found for this user in this market.")
      );
      await pressKey();
      return;
    }

    const sharesStr = await input({
      message: `Shares to burn (current: ${lp.shares.toString()}, or "all"):`,
      default: "all",
    });

    const sharesToBurn = sharesStr === "all" ? lp.shares : new BN(sharesStr);

    const balanceBefore = await getTokenBalance(state.connection, providerAta);

    await program.methods
      .removeLiquidity({ sharesToBurn })
      .accountsPartial({
        provider: user.pubkey,
        market: marketPda,
        lpPosition,
        vaultAuthority,
        vault: marketData.vault,
        providerAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const balanceAfter = await getTokenBalance(state.connection, providerAta);

    showSuccess(`Removed liquidity from Market #${sm.id}`);
    console.log(
      `  Collateral returned: ${formatTokenAmount(balanceAfter - balanceBefore)} USDC`
    );
  } catch (e) {
    showError(e);
  }

  await pressKey();
}

module.exports = { addLiquidity, removeLiquidity };
