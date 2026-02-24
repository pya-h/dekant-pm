import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { expect } from "chai";
import { ctx } from "./helpers/context";
import { ensureSetup } from "./helpers/setup";
import { findUserPosition, findLpPosition, findMarket, findVaultAuthority, findUserRole } from "./helpers/pda";
import { getOrCreateAta, mintTokens } from "./helpers/accounts";
import { createBinaryMarket } from "./helpers/market-helper";
import { ROLE_ORACLE, ROLE_CREATOR, MARKET_TYPE_BINARY } from "./helpers/constants";

describe("Deadline Boundary & Lazy Transition", () => {
  let marketPda: PublicKey;
  let vaultAuthority: PublicKey;
  let vault: PublicKey;
  let deadline: number;

  before(async () => {
    await ensureSetup();
    deadline = Math.floor(Date.now() / 1000) + 5;
    const mkt = await createBinaryMarket({ deadline });
    marketPda = mkt.marketPda;
    vaultAuthority = mkt.vaultAuthority;
    vault = mkt.vault;
  });

  it("buy after deadline returns MarketClosed error", async () => {
    const now = Math.floor(Date.now() / 1000);
    const waitMs = (deadline - now + 2) * 1000;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    // Market should still be Active on-chain (no one touched it yet)
    let market = await ctx.program.account.market.fetch(marketPda);
    expect(market.state).to.equal(0);

    const traderAAta = await getOrCreateAta(
      ctx.collateralMint,
      ctx.traderA.publicKey,
      ctx.traderA
    );
    await mintTokens(ctx.collateralMint, traderAAta, (ctx.superadmin as any).payer, BigInt(5_000_000));
    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);

    // The lazy transition + Err return means the Solana runtime
    // rolls back ALL changes (including the state transition).
    // State stays Active until resolve_market is called.
    try {
      await ctx.program.methods
        .buy({ outcome: 0, collateralAmount: new BN(1_000_000) })
        .accountsPartial({
          trader: ctx.traderA.publicKey,
          market: marketPda,
          protocolConfig: ctx.protocolConfig,
          userPosition: posA,
          vaultAuthority,
          vault,
          traderAta: traderAAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([ctx.traderA])
        .rpc();
      expect.fail("Should have thrown MarketClosed");
    } catch (err: any) {
      expect(err.toString()).to.include("MarketClosed");
    }

    // State stays Active (tx was rolled back)
    market = await ctx.program.account.market.fetch(marketPda);
    expect(market.state).to.equal(0);
  });

  it("resolve_market succeeds after deadline via its own lazy transition", async () => {
    // Even though the market is still Active, resolve_market internally
    // transitions Active -> PendingResolution -> Resolved in one tx
    await ctx.program.methods
      .resolveMarket({ outcome: 0, value: new BN(0) })
      .accountsPartial({
        oracle: ctx.oracleKp.publicKey,
        market: marketPda,
      })
      .signers([ctx.oracleKp])
      .rpc();

    const market = await ctx.program.account.market.fetch(marketPda);
    expect(market.state).to.equal(3);
  });

  it("remove_liquidity after deadline returns MarketClosed error", async () => {
    const dl = Math.floor(Date.now() / 1000) + 5;
    const mkt = await createBinaryMarket({ deadline: dl });

    const now = Math.floor(Date.now() / 1000);
    const waitMs = (dl - now + 2) * 1000;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    const lpAta = await getOrCreateAta(
      ctx.collateralMint,
      ctx.creatorKp.publicKey,
      ctx.creatorKp
    );
    const [creatorLpPos] = findLpPosition(
      mkt.marketPda,
      ctx.creatorKp.publicKey,
      ctx.program.programId
    );
    const lpPos = await ctx.program.account.lpPosition.fetch(creatorLpPos);

    try {
      await ctx.program.methods
        .removeLiquidity({ sharesToBurn: lpPos.shares })
        .accountsPartial({
          provider: ctx.creatorKp.publicKey,
          market: mkt.marketPda,
          lpPosition: creatorLpPos,
          vaultAuthority: mkt.vaultAuthority,
          vault: mkt.vault,
          providerAta: lpAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([ctx.creatorKp])
        .rpc();
      expect.fail("Should have thrown MarketClosed");
    } catch (err: any) {
      expect(err.toString()).to.include("MarketClosed");
    }
  });
});
