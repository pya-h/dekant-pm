const readline = require("readline");
const { select, Separator } = require("@inquirer/prompts");
const chalk = require("chalk");
const { SessionState } = require("./state");
const { clear, banner, pressKey } = require("./ui");
const { addUser, assignRole, fundUser } = require("./actions/user");
const { createMarket, pauseUnpause } = require("./actions/market");
const { buyOutcome, sellOutcome } = require("./actions/trade");
const { addLiquidity, removeLiquidity } = require("./actions/liquidity");
const { resolveMarket, claimPayout, collectFees } = require("./actions/settle");
const { queryMarketInfo, viewPosition } = require("./actions/query");

async function main() {
  clear();
  console.log(chalk.cyan.bold("\n  Initializing DekantPM Operator CLI...\n"));

  let state;
  try {
    state = new SessionState();
  } catch (e) {
    console.log(chalk.red(`  Failed to connect: ${e.message}`));
    process.exit(1);
  }

  try {
    await state.verifyProtocol();
    console.log(chalk.green("  Protocol verified."));
  } catch (e) {
    console.log(chalk.red(`  ${e.message}`));
    process.exit(1);
  }

  console.log(
    chalk.dim(`  Superuser: ${state.superuser.pubkey.toBase58()}`)
  );
  console.log();

  // Ctrl+R toggle for random mode
  readline.emitKeypressEvents(process.stdin);
  process.stdin.on("keypress", (_str, key) => {
    if (key && key.ctrl && key.name === "r") {
      state.randomMode = !state.randomMode;
    }
  });

  await pressKey("Press Enter to start...");

  // Main menu loop
  while (true) {
    clear();
    banner(state);

    let action;
    try {
      action = await select({
        message: "What would you like to do?",
        choices: [
          new Separator(chalk.dim("── User Management ──")),
          { name: "Add New User", value: "add-user" },
          { name: "Assign Role", value: "assign-role" },
          { name: "Fund User", value: "fund-user" },
          new Separator(chalk.dim("── Market Operations ──")),
          { name: "Create Market", value: "create-market" },
          { name: "Pause / Unpause Market", value: "pause-unpause" },
          new Separator(chalk.dim("── Trading ──")),
          { name: "Buy Outcome", value: "buy" },
          { name: "Sell Outcome", value: "sell" },
          new Separator(chalk.dim("── Liquidity ──")),
          { name: "Add Liquidity", value: "add-lp" },
          { name: "Remove Liquidity", value: "remove-lp" },
          new Separator(chalk.dim("── Settlement ──")),
          { name: "Resolve Market", value: "resolve" },
          { name: "Claim Payout", value: "claim" },
          { name: "Collect Fees", value: "collect-fees" },
          new Separator(chalk.dim("── Query ──")),
          { name: "View Position", value: "view-position" },
          { name: "Query Market Info", value: "query-market" },
          new Separator(""),
          { name: chalk.red("Exit"), value: "exit" },
        ],
      });
    } catch (e) {
      // Ctrl+C exits inquirer with ExitPromptError
      break;
    }

    if (action === "exit") break;

    clear();
    try {
      switch (action) {
        case "add-user":
          await addUser(state);
          break;
        case "assign-role":
          await assignRole(state);
          break;
        case "fund-user":
          await fundUser(state);
          break;
        case "create-market":
          await createMarket(state);
          break;
        case "pause-unpause":
          await pauseUnpause(state);
          break;
        case "buy":
          await buyOutcome(state);
          break;
        case "sell":
          await sellOutcome(state);
          break;
        case "add-lp":
          await addLiquidity(state);
          break;
        case "remove-lp":
          await removeLiquidity(state);
          break;
        case "resolve":
          await resolveMarket(state);
          break;
        case "claim":
          await claimPayout(state);
          break;
        case "collect-fees":
          await collectFees(state);
          break;
        case "view-position":
          await viewPosition(state);
          break;
        case "query-market":
          await queryMarketInfo(state);
          break;
      }
    } catch (e) {
      // Ctrl+C during an action should return to main menu, not crash
      if (e.name === "ExitPromptError") continue;
      console.log(chalk.red(`\n  Unexpected error: ${e.message}`));
      await pressKey();
    }
  }

  console.log(chalk.dim("\n  Goodbye!\n"));
  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
