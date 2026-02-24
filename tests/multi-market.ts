import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { expect } from "chai";
import { ctx } from "./helpers/context";
import { ensureSetup } from "./helpers/setup";
import { findUserPosition } from "./helpers/pda";
import { getOrCreateAta, mintTokens } from "./helpers/accounts";
import { createMultiMarket } from "./helpers/market-helper";
import { MARKET_TYPE_MULTI, randomAmount } from "./helpers/constants";

describe("Multi-Outcome Market Lifecycle", () => {
  let marketPda: PublicKey;
  let vaultAuthority: PublicKey;
  let vault: PublicKey;
  const NUM_OUTCOMES = 5;
  const initialLiquidity = new BN(20_000_000);
  const buyAmountA = randomAmount(1_500_000, 4_000_000);
  const buyAmountB = randomAmount(1_500_000, 4_000_000);
  const outcomeA = 2;
  const outcomeB = 4;

  before(async () => {
    await ensureSetup();
    const deadline = Math.floor(Date.now() / 1000) + 30;
    const mkt = await createMultiMarket({
      numOutcomes: NUM_OUTCOMES,
      deadline,
      liquidity: initialLiquidity,
    });
    marketPda = mkt.marketPda;
    vaultAuthority = mkt.vaultAuthority;
    vault = mkt.vault;
  });

  it("creates a 5-outcome multi market with correct state", async () => {
    const market = await ctx.program.account.market.fetch(marketPda);
    expect(market.marketType).to.equal(MARKET_TYPE_MULTI);
    expect(market.numOutcomes).to.equal(NUM_OUTCOMES);
    expect(market.reserves.length).to.equal(NUM_OUTCOMES);
    expect(market.state).to.equal(0);
  });

  it("multiple traders buy different outcomes", async () => {
    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const traderAAta = await getOrCreateAta(ctx.collateralMint, ctx.traderA.publicKey, ctx.traderA);
    await mintTokens(ctx.collateralMint, traderAAta, (ctx.superadmin as any).payer, BigInt(50_000_000));

    await ctx.program.methods
      .buy({ outcome: outcomeA, collateralAmount: new BN(buyAmountA) })
      .accountsPartial({
        trader: ctx.traderA.publicKey,
        market: marketPda,
        protocolConfig: ctx.protocolConfig,
        userPosition: posA,
        vaultAuthority,
        vault,
        traderAta: traderAAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: require("@solana/web3.js").SystemProgram.programId,
      })
      .signers([ctx.traderA])
      .rpc();

    const [posB] = findUserPosition(marketPda, ctx.traderB.publicKey, ctx.program.programId);
    const traderBAta = await getOrCreateAta(ctx.collateralMint, ctx.traderB.publicKey, ctx.traderB);
    await mintTokens(ctx.collateralMint, traderBAta, (ctx.superadmin as any).payer, BigInt(50_000_000));

    await ctx.program.methods
      .buy({ outcome: outcomeB, collateralAmount: new BN(buyAmountB) })
      .accountsPartial({
        trader: ctx.traderB.publicKey,
        market: marketPda,
        protocolConfig: ctx.protocolConfig,
        userPosition: posB,
        vaultAuthority,
        vault,
        traderAta: traderBAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: require("@solana/web3.js").SystemProgram.programId,
      })
      .signers([ctx.traderB])
      .rpc();

    const positionA = await ctx.program.account.userPosition.fetch(posA);
    const positionB = await ctx.program.account.userPosition.fetch(posB);
    expect(positionA.holdings[outcomeA].toNumber()).to.be.greaterThan(0);
    expect(positionB.holdings[outcomeB].toNumber()).to.be.greaterThan(0);
  });

  it("oracle resolves multi-outcome market (outcome 2 wins)", async () => {
    const market = await ctx.program.account.market.fetch(marketPda);
    const now = Math.floor(Date.now() / 1000);
    const waitMs = (market.deadline.toNumber() - now + 2) * 1000;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    await ctx.program.methods
      .resolveMarket({ outcome: outcomeA, value: new BN(0) })
      .accountsPartial({
        oracle: ctx.oracleKp.publicKey,
        market: marketPda,
      })
      .signers([ctx.oracleKp])
      .rpc();

    const resolved = await ctx.program.account.market.fetch(marketPda);
    expect(resolved.state).to.equal(3);
    expect(resolved.resolvedOutcome).to.equal(outcomeA);
  });

  it("winner (trader A) claims; loser (trader B) fails to claim", async () => {
    const [posA] = findUserPosition(marketPda, ctx.traderA.publicKey, ctx.program.programId);
    const traderAAta = await getAssociatedTokenAddress(ctx.collateralMint, ctx.traderA.publicKey);

    await ctx.program.methods
      .claimPayout()
      .accountsPartial({
        trader: ctx.traderA.publicKey,
        market: marketPda,
        protocolConfig: ctx.protocolConfig,
        userPosition: posA,
        vaultAuthority,
        vault,
        traderAta: traderAAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([ctx.traderA])
      .rpc();

    const positionA = await ctx.program.account.userPosition.fetch(posA);
    expect(positionA.claimed).to.be.true;

    const [posB] = findUserPosition(marketPda, ctx.traderB.publicKey, ctx.program.programId);
    const traderBAta = await getAssociatedTokenAddress(ctx.collateralMint, ctx.traderB.publicKey);

    try {
      await ctx.program.methods
        .claimPayout()
        .accountsPartial({
          trader: ctx.traderB.publicKey,
          market: marketPda,
          protocolConfig: ctx.protocolConfig,
          userPosition: posB,
          vaultAuthority,
          vault,
          traderAta: traderBAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([ctx.traderB])
        .rpc();
      expect.fail("Loser should not be able to claim");
    } catch (err: any) {
      expect(err.toString()).to.include("NothingToClaim");
    }
  });
});
