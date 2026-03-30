const { select } = require("@inquirer/prompts");
const chalk = require("chalk");
const { fundUser } = require("./user");
const { airdropSuperuser } = require("./superuser");
const { createSplToken } = require("./token");

// ─── Funding Tools Submenu ──────────────────────────────────────────────────

async function fundingTools(state) {
  const action = await select({
    message: "Funding Tools:",
    choices: [
      { name: "Fund User", value: "fund-user", description: "Transfer SOL or mint SPL tokens to a user" },
      { name: "Charge Superuser (Airdrop SOL)", value: "charge-super", description: "Airdrop SOL to superuser account" },
      { name: "Create SPL Token", value: "create-token", description: "Deploy a new SPL token and mint to superuser" },
      { name: chalk.red("Back"), value: "back" },
    ],
  });

  if (action === "back") return;

  switch (action) {
    case "fund-user":
      await fundUser(state);
      break;
    case "charge-super":
      await airdropSuperuser(state);
      break;
    case "create-token":
      await createSplToken(state);
      break;
  }
}

module.exports = { fundingTools };
