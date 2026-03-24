import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PublicKey, ComputeBudgetProgram } from "@solana/web3.js";
import type { Program } from "@coral-xyz/anchor";
import type { DekantPm } from "@/lib/program/dekant_pm";

// Mock @/lib/solana so we skip the IDL load and "use client" hook
vi.mock("@/lib/solana", () => {
  const { PublicKey } = require("@solana/web3.js");
  const MOCK_PK = new PublicKey("11111111111111111111111111111111");
  return {
    PROGRAM_ID: MOCK_PK,
    deriveProtocolConfig: vi.fn(() => [MOCK_PK, 255]),
    deriveUserPosition: vi.fn(() => [MOCK_PK, 255]),
    deriveLpPosition: vi.fn(() => [MOCK_PK, 255]),
    deriveVaultAuthority: vi.fn(() => [MOCK_PK, 255]),
  };
});

import {
  executeBuy,
  executeSell,
  executeBuyDistribution,
  executeClaimPayout,
} from "@/lib/transactions";

// ---------------------------------------------------------------------------
// Stub PublicKey.findProgramAddressSync so the internal getAta() helper works
// in the jsdom test environment without real Ed25519 derivation.
// ---------------------------------------------------------------------------

const DUMMY_PK = new PublicKey(
  "F7dR6Ho8aCm9SBD2aNfJChTdpQpNvPmKjXZGSfjLZHKL",
);
const realFindPDA = PublicKey.findProgramAddressSync;

beforeEach(() => {
  // Override the static method — it's only used by getAta() in this test
  // since deriveXxx functions are already mocked via @/lib/solana.
  (PublicKey as any).findProgramAddressSync = vi
    .fn()
    .mockReturnValue([DUMMY_PK, 255]);

  // ComputeBudgetProgram.setComputeUnitLimit uses buffer-layout which
  // is incompatible with jsdom's Buffer implementation.
  vi.spyOn(ComputeBudgetProgram, "setComputeUnitLimit").mockReturnValue(
    {} as any,
  );
});

afterEach(() => {
  (PublicKey as any).findProgramAddressSync = realFindPDA;
});

// ---------------------------------------------------------------------------
// Helpers to create a mock Anchor Program with a fluent API
// ---------------------------------------------------------------------------

function createMockProgram() {
  const rpc = vi.fn().mockResolvedValue("mock-signature");
  const preInstructions = vi.fn().mockReturnValue({ rpc });
  const accountsPartial = vi
    .fn()
    .mockReturnValue({ rpc, preInstructions });

  const methods: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of [
    "buy",
    "sell",
    "buyDistribution",
    "sellDistribution",
    "claimPayout",
    "buyToPrice",
    "sellToPrice",
  ]) {
    methods[name] = vi.fn().mockReturnValue({ accountsPartial });
  }

  const program = {
    methods,
    account: {
      market: {
        fetch: vi.fn().mockResolvedValue({
          collateralMint: new PublicKey(
            "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          ),
          vault: new PublicKey("11111111111111111111111111111111"),
        }),
      },
    },
  } as unknown as Program<DekantPm>;

  return { program, methods, rpc, accountsPartial };
}

const MARKET_PK = new PublicKey(
  "F7dR6Ho8aCm9SBD2aNfJChTdpQpNvPmKjXZGSfjLZHKL",
);
const TRADER_PK = new PublicKey(
  "HXtBm8XZbxaTt41uqaKhwUAa6Z1aPyvJdsZVENiWsetg",
);

// ---------------------------------------------------------------------------
// executeBuy
// ---------------------------------------------------------------------------

describe("executeBuy", () => {
  it("calls program.methods.buy with correct outcome and collateral amount", async () => {
    const { program, methods } = createMockProgram();

    const sig = await executeBuy(program, MARKET_PK, TRADER_PK, 0, "1.5");

    expect(sig).toBe("mock-signature");
    expect(methods.buy).toHaveBeenCalledTimes(1);

    const args = methods.buy.mock.calls[0][0];
    expect(args.outcome).toBe(0);
    // toBaseUnits("1.5") → "1" + "500000" → BN("1500000")
    expect(args.collateralAmount.toString()).toBe("1500000");
  });

  it("handles whole numbers without decimals", async () => {
    const { program, methods } = createMockProgram();
    await executeBuy(program, MARKET_PK, TRADER_PK, 1, "10");

    const args = methods.buy.mock.calls[0][0];
    expect(args.outcome).toBe(1);
    expect(args.collateralAmount.toString()).toBe("10000000");
  });

  it("handles amounts with many decimal places (truncates to 6)", async () => {
    const { program, methods } = createMockProgram();
    await executeBuy(program, MARKET_PK, TRADER_PK, 0, "1.1234567");

    const args = methods.buy.mock.calls[0][0];
    expect(args.collateralAmount.toString()).toBe("1123456");
  });
});

// ---------------------------------------------------------------------------
// executeSell
// ---------------------------------------------------------------------------

describe("executeSell", () => {
  it("calls program.methods.sell with correct outcome and token amount", async () => {
    const { program, methods } = createMockProgram();

    await executeSell(program, MARKET_PK, TRADER_PK, 1, "5");

    expect(methods.sell).toHaveBeenCalledTimes(1);
    const args = methods.sell.mock.calls[0][0];
    expect(args.outcome).toBe(1);
    expect(args.tokenAmount.toString()).toBe("5000000");
  });
});

// ---------------------------------------------------------------------------
// executeBuyDistribution
// ---------------------------------------------------------------------------

describe("executeBuyDistribution", () => {
  it("scales mu and sigma by SCALE factor (1e9)", async () => {
    const { program, methods } = createMockProgram();

    await executeBuyDistribution(program, MARKET_PK, TRADER_PK, 50, 10, "20");

    expect(methods.buyDistribution).toHaveBeenCalledTimes(1);
    const args = methods.buyDistribution.mock.calls[0][0];
    expect(args.mu.toString()).toBe("50000000000"); // 50 * 1e9
    expect(args.sigma.toString()).toBe("10000000000"); // 10 * 1e9
    expect(args.collateralAmount.toString()).toBe("20000000"); // 20 USDC
  });
});

// ---------------------------------------------------------------------------
// executeClaimPayout
// ---------------------------------------------------------------------------

describe("executeClaimPayout", () => {
  it("calls claimPayout and returns signature", async () => {
    const { program, methods } = createMockProgram();

    const sig = await executeClaimPayout(program, MARKET_PK, TRADER_PK);

    expect(sig).toBe("mock-signature");
    expect(methods.claimPayout).toHaveBeenCalledTimes(1);
  });
});
