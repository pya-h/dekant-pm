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
  executeSellDistribution,
  executeBuyToPrice,
  executeSellToPrice,
  executeClaimPayout,
} from "@/lib/transactions";

// ---------------------------------------------------------------------------
// Stub PublicKey.findProgramAddressSync so the internal getAta() helper works
// in the jsdom test environment without real Ed25519 derivation.
// ---------------------------------------------------------------------------

const DUMMY_PK = new PublicKey(
  "4GYvtbs7da26tLaZt9PNQWLesq2riwEN6fi9tGF91A5P",
);
const realFindPDA = PublicKey.findProgramAddressSync;

beforeEach(() => {
  // Override the static method — it's only used by getAta() in this test
  // since deriveXxx functions are already mocked via @/lib/solana.
  (PublicKey as any).findProgramAddressSync = vi
    .fn()
    .mockReturnValue([DUMMY_PK, 255]);

  // ComputeBudgetProgram uses buffer-layout which is incompatible with
  // jsdom's Buffer implementation.
  vi.spyOn(ComputeBudgetProgram, "setComputeUnitLimit").mockReturnValue(
    {} as any,
  );
  vi.spyOn(ComputeBudgetProgram, "setComputeUnitPrice").mockReturnValue(
    {} as any,
  );
});

afterEach(() => {
  (PublicKey as any).findProgramAddressSync = realFindPDA;
});

// ---------------------------------------------------------------------------
// Helpers to create a mock Anchor Program with a fluent API
// ---------------------------------------------------------------------------

/** Fake serialized transaction (just needs to be a valid Uint8Array) */
const FAKE_SERIALIZED = new Uint8Array([1, 2, 3]);

function createMockProgram() {
  const mockTx = {
    recentBlockhash: null as string | null,
    feePayer: null as PublicKey | null,
    serialize: vi.fn().mockReturnValue(FAKE_SERIALIZED),
  };
  const transaction = vi.fn().mockResolvedValue(mockTx);
  const preInstructions = vi.fn().mockReturnValue({ transaction });
  const accountsPartial = vi
    .fn()
    .mockReturnValue({ preInstructions, transaction });

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

  const mockConnection = {
    getLatestBlockhash: vi.fn().mockResolvedValue({
      blockhash: "mock-blockhash",
      lastValidBlockHeight: 999,
    }),
    sendRawTransaction: vi.fn().mockResolvedValue("mock-signature"),
    confirmTransaction: vi.fn().mockResolvedValue({ value: { err: null } }),
  };

  const mockWallet = {
    publicKey: DUMMY_PK,
    signTransaction: vi.fn().mockResolvedValue(mockTx),
  };

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
    provider: {
      connection: mockConnection,
      wallet: mockWallet,
    },
  } as unknown as Program<DekantPm>;

  return { program, methods, accountsPartial, mockConnection, mockWallet };
}

const MARKET_PK = new PublicKey(
  "4GYvtbs7da26tLaZt9PNQWLesq2riwEN6fi9tGF91A5P",
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

// ---------------------------------------------------------------------------
// executeSellDistribution
// ---------------------------------------------------------------------------

describe("executeSellDistribution", () => {
  it("scales mu and sigma by SCALE factor and converts amount to base units", async () => {
    const { program, methods } = createMockProgram();

    await executeSellDistribution(program, MARKET_PK, TRADER_PK, 50, 10, "20");

    expect(methods.sellDistribution).toHaveBeenCalledTimes(1);
    const args = methods.sellDistribution.mock.calls[0][0];
    expect(args.mu.toString()).toBe("50000000000"); // 50 * 1e9
    expect(args.sigma.toString()).toBe("10000000000"); // 10 * 1e9
    expect(args.tokenAmount.toString()).toBe("20000000"); // 20 USDC base units
  });

  it("handles fractional amounts", async () => {
    const { program, methods } = createMockProgram();

    await executeSellDistribution(program, MARKET_PK, TRADER_PK, 100.5, 25.3, "0.5");

    const args = methods.sellDistribution.mock.calls[0][0];
    expect(args.mu.toString()).toBe("100500000000"); // 100.5 * 1e9
    expect(args.sigma.toString()).toBe("25300000000"); // 25.3 * 1e9
    expect(args.tokenAmount.toString()).toBe("500000"); // 0.5 USDC
  });
});

// ---------------------------------------------------------------------------
// executeBuyToPrice
// ---------------------------------------------------------------------------

describe("executeBuyToPrice", () => {
  it("passes outcome, targetProbability, and maxCollateral to program", async () => {
    const { program, methods } = createMockProgram();
    const { BN } = await import("@coral-xyz/anchor");

    const targetProb = new BN(500_000_000); // 0.5 in SCALE
    const maxCollateral = new BN(10_000_000); // 10 USDC

    const sig = await executeBuyToPrice(
      program, MARKET_PK, TRADER_PK, 0, targetProb, maxCollateral,
    );

    expect(sig).toBe("mock-signature");
    expect(methods.buyToPrice).toHaveBeenCalledTimes(1);
    const args = methods.buyToPrice.mock.calls[0][0];
    expect(args.outcome).toBe(0);
    expect(args.targetProbability.toString()).toBe("500000000");
    expect(args.maxCollateral.toString()).toBe("10000000");
  });
});

// ---------------------------------------------------------------------------
// executeSellToPrice
// ---------------------------------------------------------------------------

describe("executeSellToPrice", () => {
  it("passes outcome, targetProbability, and minCollateralOut to program", async () => {
    const { program, methods } = createMockProgram();
    const { BN } = await import("@coral-xyz/anchor");

    const targetProb = new BN(300_000_000); // 0.3 in SCALE
    const minCollateralOut = new BN(5_000_000); // 5 USDC

    const sig = await executeSellToPrice(
      program, MARKET_PK, TRADER_PK, 1, targetProb, minCollateralOut,
    );

    expect(sig).toBe("mock-signature");
    expect(methods.sellToPrice).toHaveBeenCalledTimes(1);
    const args = methods.sellToPrice.mock.calls[0][0];
    expect(args.outcome).toBe(1);
    expect(args.targetProbability.toString()).toBe("300000000");
    expect(args.minCollateralOut.toString()).toBe("5000000");
  });
});
