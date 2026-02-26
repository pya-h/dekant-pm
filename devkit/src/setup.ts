#!/usr/bin/env ts-node
import { Command } from "commander";
import {
  loadContext,
  findProtocolConfig,
  findUserRole,
  ROLE_ADMIN,
  ROLE_ORACLE,
  ROLE_CREATOR,
  ROLE_NAMES,
  formatTokenAmount,
  formatTimestamp,
  printTable,
  BN,
  PublicKey,
  SystemProgram,
  TOKEN_PROGRAM_ID,
  getOrCreateAta,
  findMarket,
  findVaultAuthority,
} from "./common";

const program_ = new Command();

program_
  .name("setup")
  .description("DekantPM protocol setup and administration");

// ─── init ────────────────────────────────────────────────────────────────────
program_
  .command("init")
  .description("Initialize the DekantPM protocol (one-time)")
  .option("--treasury <address>", "Treasury wallet address (default: signer)")
  .action(async (opts) => {
    const { program, keypair, programId, connection } = loadContext();
    const treasury = opts.treasury
      ? new PublicKey(opts.treasury)
      : keypair.publicKey;

    const [protocolConfig] = findProtocolConfig(programId);

    console.log("Initializing DekantPM protocol...");
    console.log(`  Superadmin:  ${keypair.publicKey.toBase58()}`);
    console.log(`  Treasury:    ${treasury.toBase58()}`);
    console.log(`  Config PDA:  ${protocolConfig.toBase58()}`);

    try {
      const tx = await program.methods
        .initialize({ treasury })
        .accountsPartial({
          authority: keypair.publicKey,
          protocolConfig,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log(`\n  Protocol initialized! Tx: ${tx}`);
    } catch (e: any) {
      if (e.message?.includes("already in use")) {
        console.log("\n  Protocol already initialized.");
        const config = await program.account.protocolConfig.fetch(protocolConfig);
        printTable([
          ["Superadmin", config.superadmin.toBase58()],
          ["Treasury", config.treasury.toBase58()],
          ["Market count", config.marketCount.toString()],
          ["Creation fee", `${config.creationFeeBps} bps`],
          ["Trade fee", `${config.tradeFeeBps} bps`],
          ["Redemption fee", `${config.redemptionFeeBps} bps`],
          ["LP fee share", `${config.lpFeeShareBps} bps`],
        ]);
      } else {
        throw e;
      }
    }
  });

// ─── assign-role ─────────────────────────────────────────────────────────────
program_
  .command("assign-role")
  .description("Assign a role to a wallet")
  .argument("<wallet>", "Target wallet public key")
  .argument("<role>", "Role: admin, oracle, or creator")
  .action(async (walletStr: string, roleStr: string) => {
    const { program, keypair, programId } = loadContext();
    const targetUser = new PublicKey(walletStr);
    const role = parseRole(roleStr);

    const [protocolConfig] = findProtocolConfig(programId);
    const [userRole] = findUserRole(targetUser, role, programId);

    console.log(`Assigning ${ROLE_NAMES[role]} role to ${targetUser.toBase58()}...`);

    const tx = await program.methods
      .assignRole({ role })
      .accountsPartial({
        authority: keypair.publicKey,
        protocolConfig,
        authorityRole: null,
        targetUser,
        userRole,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`  Role assigned! Tx: ${tx}`);
  });

// ─── revoke-role ─────────────────────────────────────────────────────────────
program_
  .command("revoke-role")
  .description("Revoke a role from a wallet")
  .argument("<wallet>", "Target wallet public key")
  .argument("<role>", "Role: admin, oracle, or creator")
  .action(async (walletStr: string, roleStr: string) => {
    const { program, keypair, programId } = loadContext();
    const targetUser = new PublicKey(walletStr);
    const role = parseRole(roleStr);

    const [protocolConfig] = findProtocolConfig(programId);
    const [userRole] = findUserRole(targetUser, role, programId);

    console.log(`Revoking ${ROLE_NAMES[role]} role from ${targetUser.toBase58()}...`);

    const tx = await program.methods
      .revokeRole({ role })
      .accountsPartial({
        authority: keypair.publicKey,
        protocolConfig,
        authorityRole: null,
        targetUser,
        userRole,
      })
      .rpc();

    console.log(`  Role revoked! Tx: ${tx}`);
  });

// ─── update-fees ─────────────────────────────────────────────────────────────
program_
  .command("update-fees")
  .description("Update protocol fee parameters (in basis points)")
  .argument("<creation>", "Creation fee (bps)")
  .argument("<trade>", "Trade fee (bps)")
  .argument("<redemption>", "Redemption fee (bps)")
  .argument("<lp-share>", "LP fee share (bps, fraction of trade fee)")
  .action(async (creation: string, trade: string, redemption: string, lpShare: string) => {
    const { program, keypair, programId } = loadContext();
    const [protocolConfig] = findProtocolConfig(programId);

    const creationFeeBps = parseInt(creation, 10);
    const tradeFeeBps = parseInt(trade, 10);
    const redemptionFeeBps = parseInt(redemption, 10);
    const lpFeeShareBps = parseInt(lpShare, 10);

    console.log("Updating fees...");
    printTable([
      ["Creation fee", `${creationFeeBps} bps`],
      ["Trade fee", `${tradeFeeBps} bps`],
      ["Redemption fee", `${redemptionFeeBps} bps`],
      ["LP fee share", `${lpFeeShareBps} bps`],
    ]);

    const tx = await program.methods
      .updateFees({
        creationFeeBps,
        tradeFeeBps,
        redemptionFeeBps,
        lpFeeShareBps,
      })
      .accountsPartial({
        authority: keypair.publicKey,
        protocolConfig,
      })
      .rpc();

    console.log(`\n  Fees updated! Tx: ${tx}`);
  });

// ─── collect-fees ────────────────────────────────────────────────────────────
program_
  .command("collect-fees")
  .description("Collect accumulated protocol fees from a market")
  .argument("<market-id>", "Market ID (numeric)")
  .action(async (marketIdStr: string) => {
    const { program, keypair, programId, connection } = loadContext();
    const marketId = parseInt(marketIdStr, 10);
    const [protocolConfig] = findProtocolConfig(programId);
    const [marketPda] = findMarket(marketId, programId);
    const [vaultAuthority] = findVaultAuthority(marketPda, programId);

    const market = await program.account.market.fetch(marketPda);
    const config = await program.account.protocolConfig.fetch(protocolConfig);

    const treasuryAta = await getOrCreateAta(
      connection,
      market.collateralMint,
      config.treasury,
      keypair
    );

    console.log(`Collecting fees from market #${marketId}...`);
    console.log(`  Accumulated: ${formatTokenAmount(market.protocolFeeAccumulated)}`);

    const tx = await program.methods
      .collectFees()
      .accountsPartial({
        authority: keypair.publicKey,
        protocolConfig,
        market: marketPda,
        vaultAuthority,
        vault: market.vault,
        treasuryAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log(`  Fees collected! Tx: ${tx}`);
  });

// ─── info ────────────────────────────────────────────────────────────────────
program_
  .command("info")
  .description("Display current protocol configuration")
  .action(async () => {
    const { program, programId } = loadContext();
    const [protocolConfig] = findProtocolConfig(programId);

    const config = await program.account.protocolConfig.fetch(protocolConfig);

    console.log("\nDekantPM Protocol Config:");
    printTable([
      ["Config PDA", protocolConfig.toBase58()],
      ["Version", config.version.toString()],
      ["Superadmin", config.superadmin.toBase58()],
      ["Treasury", config.treasury.toBase58()],
      ["Market count", config.marketCount.toString()],
      ["Creation fee", `${config.creationFeeBps} bps`],
      ["Trade fee", `${config.tradeFeeBps} bps`],
      ["Redemption fee", `${config.redemptionFeeBps} bps`],
      ["LP fee share", `${config.lpFeeShareBps} bps`],
    ]);
  });

// ─── Helpers ─────────────────────────────────────────────────────────────────
function parseRole(role: string): number {
  const normalized = role.toLowerCase();
  switch (normalized) {
    case "admin":
    case "1":
      return ROLE_ADMIN;
    case "oracle":
    case "2":
      return ROLE_ORACLE;
    case "creator":
    case "3":
      return ROLE_CREATOR;
    default:
      throw new Error(`Unknown role: "${role}". Use admin, oracle, or creator.`);
  }
}

program_.parse(process.argv);
