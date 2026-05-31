#!/usr/bin/env ts-node
import { Command } from "commander";
import {
  loadContext,
  findProtocolConfig,
  findUserRole,
  findMarket,
  findVaultAuthority,
  findUserPosition,
  findLpPosition,
  getTokenBalance,
  formatTokenAmount,
  formatTimestamp,
  formatProbability,
  computeProbabilities,
  outcomeLabel,
  printTable,
  ROLE_ADMIN,
  ROLE_ORACLE,
  ROLE_CREATOR,
  ROLE_NAMES,
  MARKET_TYPE_BINARY,
  MARKET_TYPE_CONTINUOUS,
  MARKET_TYPE_NAMES,
  MARKET_STATE_NAMES,
  SCALE,
  LAMPORTS_PER_SOL,
  BN,
  PublicKey,
} from "./common";

const program_ = new Command();

program_
  .name("query")
  .description("DekantPM on-chain account queries (read-only)");

// ─── markets ────────────────────────────────────────────────────────────────
program_
  .command("markets")
  .description("List all markets with summary info")
  .option("--page <n>", "Page number (1-based)", "1")
  .option("--limit <n>", "Markets per page", "10")
  .option("--type <type>", "Filter by type: binary, multi, continuous")
  .option("--state <state>", "Filter by state: active, paused, pending, resolved")
  .action(async (opts) => {
    const ctx = loadContext();
    const [protocolConfig] = findProtocolConfig(ctx.programId);
    const config = await ctx.program.account.protocolConfig.fetch(protocolConfig);
    const totalMarkets = config.marketCount.toNumber();

    if (totalMarkets === 0) {
      console.log("  No markets created yet.");
      return;
    }

    // Parse filters
    const typeFilter = opts.type ? parseTypeFilter(opts.type) : undefined;
    const stateFilter = opts.state ? parseStateFilter(opts.state) : undefined;

    // Fetch all markets (on-chain has no pagination — we fetch sequentially)
    const allMarkets: { id: number; market: any; pda: PublicKey }[] = [];
    for (let i = 0; i < totalMarkets; i++) {
      try {
        const [pda] = findMarket(i, ctx.programId);
        const market = await ctx.program.account.market.fetch(pda);
        if (typeFilter !== undefined && market.marketType !== typeFilter) continue;
        if (stateFilter !== undefined && market.state !== stateFilter) continue;
        allMarkets.push({ id: i, market, pda });
      } catch {
        // Market account may not exist if creation failed midway
      }
    }

    // Paginate
    const page = Math.max(1, parseInt(opts.page, 10));
    const limit = Math.max(1, parseInt(opts.limit, 10));
    const start = (page - 1) * limit;
    const pageMarkets = allMarkets.slice(start, start + limit);
    const totalPages = Math.ceil(allMarkets.length / limit);

    console.log(`\nMarkets (page ${page}/${totalPages}, ${allMarkets.length} total):\n`);
    console.log(
      "  " +
      "ID".padEnd(6) +
      "Type".padEnd(14) +
      "State".padEnd(18) +
      "Outcomes".padEnd(10) +
      "Deadline".padEnd(24) +
      "PDA"
    );
    console.log("  " + "─".repeat(100));

    for (const { id, market, pda } of pageMarkets) {
      const typeName = MARKET_TYPE_NAMES[market.marketType] || "?";
      const stateName = MARKET_STATE_NAMES[market.state] || "?";
      const deadline = formatTimestamp(market.deadline.toNumber());
      console.log(
        "  " +
        String(id).padEnd(6) +
        typeName.padEnd(14) +
        stateName.padEnd(18) +
        String(market.numOutcomes).padEnd(10) +
        deadline.padEnd(24) +
        pda.toBase58().slice(0, 16) + "..."
      );
    }

    if (totalPages > 1) {
      console.log(`\n  Page ${page} of ${totalPages}. Use --page <n> to navigate.`);
    }
  });

// ─── market ─────────────────────────────────────────────────────────────────
program_
  .command("market")
  .description("Show detailed info for a single market")
  .argument("<market-id>", "Market ID (numeric)")
  .action(async (marketIdStr) => {
    const ctx = loadContext();
    const marketId = parseInt(marketIdStr, 10);
    const [marketPda] = findMarket(marketId, ctx.programId);

    const market = await ctx.program.account.market.fetch(marketPda);
    const vaultBalance = await getTokenBalance(ctx.connection, market.vault);
    const probs = computeProbabilities(market.reserves, market.totalMinted);

    console.log(`\nMarket #${marketId}:`);
    printTable([
      ["PDA", marketPda.toBase58()],
      ["Type", MARKET_TYPE_NAMES[market.marketType] || `Unknown(${market.marketType})`],
      ["State", MARKET_STATE_NAMES[market.state] || `Unknown(${market.state})`],
      ["Creator", market.creator.toBase58()],
      ["Oracle", market.oracle.toBase58()],
      ["Collateral mint", market.collateralMint.toBase58()],
      ["Vault", market.vault.toBase58()],
      ["Vault balance", formatTokenAmount(vaultBalance)],
      ["Deadline", formatTimestamp(market.deadline.toNumber())],
      ["Created", formatTimestamp(market.createdAt.toNumber())],
      ["Num outcomes", market.numOutcomes.toString()],
      ["Total minted", market.totalMinted.toString()],
      ["k²", market.kSquared.toString()],
      ["LP shares total", market.lpSharesTotal.toString()],
      ["LP fee accumulated", market.lpFeeAccumulated.toString()],
      ["Protocol fee", formatTokenAmount(market.protocolFeeAccumulated)],
    ]);

    if (market.marketType === MARKET_TYPE_CONTINUOUS) {
      const rangeMin = Number(market.rangeMin.toString()) / Number(SCALE.toString());
      const rangeMax = Number(market.rangeMax.toString()) / Number(SCALE.toString());
      console.log(`\n  Range: [${rangeMin}, ${rangeMax}]`);
      const kw = market.kernelWidth;
      console.log(`  Kernel width: ${kw === 0 ? "0 (winner-take-all)" : kw}`);
    }

    if (market.state === 3) {
      console.log(`\n  Resolved outcome: ${market.resolvedOutcome}`);
      if (market.marketType === MARKET_TYPE_CONTINUOUS) {
        const resolvedVal = Number(market.resolvedValue.toString()) / Number(SCALE.toString());
        console.log(`  Resolved value: ${resolvedVal}`);
        // Only meaningful when the kernel branch ran (kernel_width > 0); WTA leaves it 0.
        if (market.kernelWidth > 0) {
          console.log(`  Scaling factor: ${market.scalingFactor.toString()}`);
        }
      }
      console.log(`  Resolved at: ${formatTimestamp(market.resolvedAt.toNumber())}`);
    }

    console.log("\n  Probabilities:");
    const maxShow = probs.length <= 10 ? probs.length : 32;
    for (let i = 0; i < Math.min(probs.length, maxShow); i++) {
      if (probs.length > 10 && probs[i] < 0.001) continue;
      const label = outcomeLabel(market.marketType, i);
      const reserve = market.reserves[i];
      const marker = market.state === 3 && i === market.resolvedOutcome ? " <-- WINNER" : "";
      console.log(`    ${label.padEnd(12)} ${formatProbability(probs[i]).padStart(8)}  (reserve: ${reserve.toString()})${marker}`);
    }
    if (probs.length > maxShow) {
      console.log(`    ... (${probs.length - maxShow} more bins)`);
    }
  });

// ─── position ───────────────────────────────────────────────────────────────
program_
  .command("position")
  .description("View a user's position in a market")
  .argument("<market-id>", "Market ID (numeric)")
  .option("--wallet <address>", "Wallet to query (default: signer)")
  .action(async (marketIdStr, opts) => {
    const ctx = loadContext();
    const marketId = parseInt(marketIdStr, 10);
    const wallet = opts.wallet ? new PublicKey(opts.wallet) : ctx.keypair.publicKey;
    const [marketPda] = findMarket(marketId, ctx.programId);
    const [userPosition] = findUserPosition(marketPda, wallet, ctx.programId);

    try {
      const position = await ctx.program.account.userPosition.fetch(userPosition);
      const market = await ctx.program.account.market.fetch(marketPda);

      console.log(`\nPosition in market #${marketId}:`);
      printTable([
        ["Market", marketPda.toBase58()],
        ["User", position.user.toBase58()],
        ["Total deposited", formatTokenAmount(position.totalDeposited)],
        ["Total withdrawn", formatTokenAmount(position.totalWithdrawn)],
        ["Claimed", position.claimed ? "Yes" : "No"],
      ]);

      console.log("\n  Holdings:");
      let hasHoldings = false;
      for (let i = 0; i < position.holdings.length; i++) {
        const h = position.holdings[i];
        if (h.toNumber() > 0) {
          hasHoldings = true;
          const label = outcomeLabel(market.marketType, i);
          console.log(`    ${label.padEnd(12)} ${h.toString()}`);
        }
      }
      if (!hasHoldings) {
        console.log("    (no holdings)");
      }
    } catch {
      console.log(`  No position found for wallet ${wallet.toBase58()} in market #${marketId}`);
    }
  });

// ─── lp ─────────────────────────────────────────────────────────────────────
program_
  .command("lp")
  .description("View a user's LP position in a market")
  .argument("<market-id>", "Market ID (numeric)")
  .option("--wallet <address>", "Wallet to query (default: signer)")
  .action(async (marketIdStr, opts) => {
    const ctx = loadContext();
    const marketId = parseInt(marketIdStr, 10);
    const wallet = opts.wallet ? new PublicKey(opts.wallet) : ctx.keypair.publicKey;
    const [marketPda] = findMarket(marketId, ctx.programId);
    const [lpPosition] = findLpPosition(marketPda, wallet, ctx.programId);

    try {
      const lp = await ctx.program.account.lpPosition.fetch(lpPosition);
      const market = await ctx.program.account.market.fetch(marketPda);

      console.log(`\nLP position in market #${marketId}:`);
      printTable([
        ["Market", marketPda.toBase58()],
        ["Provider", lp.user.toBase58()],
        ["Shares", lp.shares.toString()],
        ["Deposited collateral", formatTokenAmount(lp.depositedCollateral)],
        ["Market LP total", market.lpSharesTotal.toString()],
        ["Share %", market.lpSharesTotal.toNumber() > 0
          ? `${(lp.shares.toNumber() / market.lpSharesTotal.toNumber() * 100).toFixed(2)}%`
          : "N/A"],
      ]);
    } catch {
      console.log(`  No LP position found for wallet ${wallet.toBase58()} in market #${marketId}`);
    }
  });

// ─── roles ──────────────────────────────────────────────────────────────────
program_
  .command("roles")
  .description("Check all roles assigned to a wallet")
  .argument("<wallet>", "Wallet public key")
  .action(async (walletStr) => {
    const ctx = loadContext();
    const wallet = new PublicKey(walletStr);
    const roles = [
      { id: ROLE_ADMIN, name: "Admin" },
      { id: ROLE_ORACLE, name: "Oracle" },
      { id: ROLE_CREATOR, name: "Creator" },
    ];

    console.log(`\nRoles for ${wallet.toBase58()}:\n`);

    let hasAnyRole = false;
    for (const { id, name } of roles) {
      const [rolePda] = findUserRole(wallet, id, ctx.programId);
      try {
        await ctx.program.account.userRole.fetch(rolePda);
        console.log(`  [x] ${name}`);
        hasAnyRole = true;
      } catch {
        console.log(`  [ ] ${name}`);
      }
    }

    // Check if superadmin
    const [protocolConfig] = findProtocolConfig(ctx.programId);
    try {
      const config = await ctx.program.account.protocolConfig.fetch(protocolConfig);
      if (config.superadmin.toBase58() === wallet.toBase58()) {
        console.log(`\n  * This wallet is the protocol superadmin`);
      }
    } catch {}
  });

// ─── config ─────────────────────────────────────────────────────────────────
program_
  .command("config")
  .description("Display current protocol configuration")
  .action(async () => {
    const ctx = loadContext();
    const [protocolConfig] = findProtocolConfig(ctx.programId);

    const config = await ctx.program.account.protocolConfig.fetch(protocolConfig);

    console.log("\nDekantPM Protocol Config:");
    printTable([
      ["Config PDA", protocolConfig.toBase58()],
      ["Program ID", ctx.programId.toBase58()],
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

// ─── vault ──────────────────────────────────────────────────────────────────
program_
  .command("vault")
  .description("Show vault balance and authority for a market")
  .argument("<market-id>", "Market ID (numeric)")
  .action(async (marketIdStr) => {
    const ctx = loadContext();
    const marketId = parseInt(marketIdStr, 10);
    const [marketPda] = findMarket(marketId, ctx.programId);
    const [vaultAuthority] = findVaultAuthority(marketPda, ctx.programId);

    const market = await ctx.program.account.market.fetch(marketPda);
    const vaultBalance = await getTokenBalance(ctx.connection, market.vault);

    console.log(`\nVault for market #${marketId}:`);
    printTable([
      ["Vault address", market.vault.toBase58()],
      ["Vault authority", vaultAuthority.toBase58()],
      ["Collateral mint", market.collateralMint.toBase58()],
      ["Balance", formatTokenAmount(vaultBalance)],
      ["Protocol fees", formatTokenAmount(market.protocolFeeAccumulated)],
      ["LP fees", market.lpFeeAccumulated.toString()],
    ]);
  });

// ─── balance ────────────────────────────────────────────────────────────────
program_
  .command("balance")
  .description("Show SOL and collateral token balances for a wallet")
  .option("--wallet <address>", "Wallet to query (default: signer)")
  .option("--market <id>", "Market ID to show collateral balance for (shows all if omitted)")
  .action(async (opts) => {
    const ctx = loadContext();
    const wallet = opts.wallet ? new PublicKey(opts.wallet) : ctx.keypair.publicKey;

    console.log(`\nBalances for ${wallet.toBase58()}:\n`);

    // SOL balance
    const solBalance = await ctx.connection.getBalance(wallet);
    console.log(`  SOL: ${(solBalance / LAMPORTS_PER_SOL).toFixed(9)}`);

    // Get market count
    const [protocolConfig] = findProtocolConfig(ctx.programId);
    const config = await ctx.program.account.protocolConfig.fetch(protocolConfig);
    const totalMarkets = config.marketCount.toNumber();

    // Collect unique collateral mints
    const mintsSeen = new Map<string, { marketIds: number[]; mint: PublicKey }>();

    const marketIds = opts.market !== undefined
      ? [parseInt(opts.market, 10)]
      : Array.from({ length: totalMarkets }, (_, i) => i);

    for (const id of marketIds) {
      try {
        const [pda] = findMarket(id, ctx.programId);
        const market = await ctx.program.account.market.fetch(pda);
        const mintKey = market.collateralMint.toBase58();
        if (mintsSeen.has(mintKey)) {
          mintsSeen.get(mintKey)!.marketIds.push(id);
        } else {
          mintsSeen.set(mintKey, { marketIds: [id], mint: market.collateralMint });
        }
      } catch {}
    }

    if (mintsSeen.size === 0) {
      console.log("\n  No markets found.");
      return;
    }

    console.log("");
    for (const [mintKey, { marketIds: ids, mint }] of mintsSeen) {
      try {
        const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
        const ata = getAssociatedTokenAddressSync(mint, wallet);
        const balance = await getTokenBalance(ctx.connection, ata);
        const marketsLabel = ids.length <= 5 ? ids.join(", ") : `${ids.slice(0, 5).join(", ")}...`;
        console.log(`  Collateral (markets ${marketsLabel}):`);
        console.log(`    Mint:    ${mintKey}`);
        console.log(`    Balance: ${formatTokenAmount(balance)}`);
      } catch {
        // ATA doesn't exist — wallet has no tokens of this mint
      }
    }
  });

// ─── helpers ────────────────────────────────────────────────────────────────
function parseTypeFilter(t: string): number | undefined {
  switch (t.toLowerCase()) {
    case "binary": return 0;
    case "multi": return 1;
    case "continuous": return 2;
    default: throw new Error(`Unknown type filter: "${t}". Use binary, multi, or continuous.`);
  }
}

function parseStateFilter(s: string): number | undefined {
  switch (s.toLowerCase()) {
    case "active": return 0;
    case "paused": return 1;
    case "pending": return 2;
    case "resolved": return 3;
    default: throw new Error(`Unknown state filter: "${s}". Use active, paused, pending, or resolved.`);
  }
}

program_.parse(process.argv);
