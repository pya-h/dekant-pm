import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PublicKey } from "@solana/web3.js";
import { TradingPanel } from "@/components/trading/trading-panel";
import {
  mockBinaryMarket,
  mockMultiMarket,
  mockContinuousMarket,
  mockResolvedMarket,
} from "../helpers/mock-data";
import { MarketState } from "@/lib/types";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockSetVisible = vi.fn();

vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: vi.fn(() => ({ connected: false, publicKey: null })),
}));

vi.mock("@solana/wallet-adapter-react-ui", () => ({
  useWalletModal: () => ({ setVisible: mockSetVisible }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/lib/solana", () => ({
  useProgram: vi.fn(() => null),
  PROGRAM_ID: "11111111111111111111111111111111",
  deriveProtocolConfig: vi.fn(() => [null, 0]),
  deriveUserPosition: vi.fn(() => [null, 0]),
  deriveLpPosition: vi.fn(() => [null, 0]),
  deriveVaultAuthority: vi.fn(() => [null, 0]),
}));

vi.mock("@/hooks/use-user-position", () => ({
  useUserMarketPosition: () => ({ data: null }),
}));

vi.mock("@/hooks/use-token-balance", () => ({
  useTokenBalance: () => ({ data: 1_000_000_000 }), // 1000 USDC base units
}));

vi.mock("@/lib/transactions", () => ({
  executeBuy: vi.fn().mockResolvedValue("mock-sig-123"),
  executeSell: vi.fn().mockResolvedValue("mock-sig-456"),
  executeBuyDistribution: vi.fn(),
  executeSellDistribution: vi.fn(),
  executeBuyToPrice: vi.fn(),
  executeSellToPrice: vi.fn(),
}));

vi.mock("@/components/common/transaction-toast", () => ({
  showTradeSuccess: vi.fn(),
  showTradeError: vi.fn(),
}));

// CostPreview makes API calls — stub it
vi.mock("@/components/trading/cost-preview", () => ({
  CostPreview: () => <div data-testid="cost-preview" />,
}));

// Access mocked modules for assertions
import { useWallet } from "@solana/wallet-adapter-react";
import { useProgram } from "@/lib/solana";
import { executeBuy } from "@/lib/transactions";
import { showTradeSuccess } from "@/components/common/transaction-toast";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TradingPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Wallet connection state ───────────────────────────────────────

  it("shows 'Connect Wallet' button when wallet not connected", () => {
    vi.mocked(useWallet).mockReturnValue({
      connected: false,
      publicKey: null,
    } as any);

    render(<TradingPanel market={mockBinaryMarket} />);
    expect(
      screen.getByRole("button", { name: /Connect Wallet/i }),
    ).toBeInTheDocument();
  });

  it("shows Buy/Sell tabs when wallet is connected", () => {
    vi.mocked(useWallet).mockReturnValue({
      connected: true,
      publicKey: new PublicKey(
        "4GYvtbs7da26tLaZt9PNQWLesq2riwEN6fi9tGF91A5P",
      ),
    } as any);

    render(<TradingPanel market={mockBinaryMarket} />);
    expect(screen.getByRole("tab", { name: /Buy/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Sell/i })).toBeInTheDocument();
  });

  // ── Disabled states ───────────────────────────────────────────────

  it("shows disabled message for resolved market", () => {
    vi.mocked(useWallet).mockReturnValue({
      connected: true,
      publicKey: new PublicKey(
        "4GYvtbs7da26tLaZt9PNQWLesq2riwEN6fi9tGF91A5P",
      ),
    } as any);

    render(<TradingPanel market={mockResolvedMarket} />);
    expect(
      screen.getByText("This market has been resolved"),
    ).toBeInTheDocument();
  });

  it("shows disabled message for paused market", () => {
    vi.mocked(useWallet).mockReturnValue({
      connected: true,
      publicKey: new PublicKey(
        "4GYvtbs7da26tLaZt9PNQWLesq2riwEN6fi9tGF91A5P",
      ),
    } as any);

    const pausedMarket = { ...mockBinaryMarket, state: MarketState.Paused };
    render(<TradingPanel market={pausedMarket} />);
    expect(screen.getByText("Trading is paused")).toBeInTheDocument();
  });

  // ── Market type rendering ─────────────────────────────────────────

  it("renders outcome buttons for binary market", () => {
    vi.mocked(useWallet).mockReturnValue({
      connected: true,
      publicKey: new PublicKey(
        "4GYvtbs7da26tLaZt9PNQWLesq2riwEN6fi9tGF91A5P",
      ),
    } as any);

    render(<TradingPanel market={mockBinaryMarket} />);
    // BinaryInput renders Yes/No buttons
    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(screen.getByText("No")).toBeInTheDocument();
  });

  it("renders outcome list for multi-outcome market", () => {
    vi.mocked(useWallet).mockReturnValue({
      connected: true,
      publicKey: new PublicKey(
        "4GYvtbs7da26tLaZt9PNQWLesq2riwEN6fi9tGF91A5P",
      ),
    } as any);

    render(<TradingPanel market={mockMultiMarket} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
  });

  it("renders distribution input for continuous market", () => {
    vi.mocked(useWallet).mockReturnValue({
      connected: true,
      publicKey: new PublicKey(
        "4GYvtbs7da26tLaZt9PNQWLesq2riwEN6fi9tGF91A5P",
      ),
    } as any);

    render(<TradingPanel market={mockContinuousMarket} />);
    // DistributionInput has "Your prediction" label and "Confidence" slider
    expect(screen.getAllByText("Your prediction").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Confidence").length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Trade flow integration test
// ---------------------------------------------------------------------------

describe("Trade flow integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useWallet).mockReturnValue({
      connected: true,
      publicKey: new PublicKey(
        "4GYvtbs7da26tLaZt9PNQWLesq2riwEN6fi9tGF91A5P",
      ),
    } as any);
    vi.mocked(useProgram).mockReturnValue({ programId: "mock" } as any);
    vi.mocked(executeBuy).mockResolvedValue("mock-sig-123");
  });

  it("buy flow: select outcome → enter amount → submit → toast shown", async () => {
    const user = userEvent.setup();
    render(<TradingPanel market={mockBinaryMarket} />);

    // 1. Select Yes outcome (it's pre-selected by default at index 0)
    // Verify the outcome label is shown
    expect(screen.getByText("Yes")).toBeInTheDocument();

    // 2. Enter amount
    const amountInput = screen.getByPlaceholderText("0.00");
    await user.type(amountInput, "10");

    // 3. Submit
    const submitButton = screen.getByRole("button", {
      name: /Place Buy Order/i,
    });
    expect(submitButton).not.toBeDisabled();
    await user.click(submitButton);

    // 4. Verify transaction was called
    await waitFor(() => {
      expect(executeBuy).toHaveBeenCalledTimes(1);
    });

    // 5. Verify toast was shown
    await waitFor(() => {
      expect(showTradeSuccess).toHaveBeenCalledWith("mock-sig-123", "Buy");
    });
  });

  it("opens wallet modal when not connected and user clicks submit", async () => {
    vi.mocked(useWallet).mockReturnValue({
      connected: false,
      publicKey: null,
    } as any);

    const user = userEvent.setup();
    render(<TradingPanel market={mockBinaryMarket} />);

    const connectButton = screen.getByRole("button", {
      name: /Connect Wallet/i,
    });
    await user.click(connectButton);

    expect(mockSetVisible).toHaveBeenCalledWith(true);
  });
});
