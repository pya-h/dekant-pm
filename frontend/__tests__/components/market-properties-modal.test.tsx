import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MarketPropertiesModal } from "@/components/market/market-properties-modal";

const mockGet = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

const mockPropertiesResponse = {
  market: {
    id: "1",
    pubkey: "4GYvtbs7da26tLaZt9PNQWLesq2riwEN6fi9tGF91A5P",
    marketType: 0,
    state: 0,
    title: "Will BTC reach $100k?",
    description: null,
    category: "Crypto",
    subject: "BTC",
    icon: null,
    tags: null,
    outcomeLabels: ["Yes", "No"],
    creator: "Creator1111111111111111111111111111111111111",
    oracle: "Oracle11111111111111111111111111111111111111",
    collateralMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    deadline: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    numOutcomes: 2,
    rangeMin: null,
    rangeMax: null,
    resolvedOutcome: null,
    resolvedValue: null,
  },
  stats: {
    totalTrades: 42,
    totalPositions: 10,
    totalLps: 3,
    totalVolume: "5000000000",
    totalTraders: 15,
    totalDeposited: "3000000000",
    protocolFeeAccumulated: "100000",
    lpFeeAccumulated: "50000",
    lpSharesTotal: "999",
    lastTradeAt: new Date().toISOString(),
  },
};

describe("MarketPropertiesModal", () => {
  const defaultProps = {
    marketId: "1",
    marketTitle: "Will BTC reach $100k?",
    open: true,
    onOpenChange: vi.fn(),
    token: "test-jwt",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue(mockPropertiesResponse);
  });

  it("fetches properties when opened", async () => {
    render(<MarketPropertiesModal {...defaultProps} />);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(
        "/markets/1/properties",
        undefined,
        "test-jwt",
      );
    });
  });

  it("renders market title in description", () => {
    render(<MarketPropertiesModal {...defaultProps} />);
    expect(screen.getByText("Will BTC reach $100k?")).toBeInTheDocument();
  });

  it("shows loading spinner while fetching", () => {
    mockGet.mockReturnValue(new Promise(() => {})); // never resolves
    render(<MarketPropertiesModal {...defaultProps} />);
    // The Loader2 SVG has animate-spin class
    const spinner = document.querySelector(".animate-spin");
    expect(spinner).not.toBeNull();
  });

  it("renders addresses section after loading", async () => {
    render(<MarketPropertiesModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Addresses")).toBeInTheDocument();
    });
    expect(screen.getByText("Market ID")).toBeInTheDocument();
    expect(screen.getByText("Creator")).toBeInTheDocument();
    expect(screen.getByText("Oracle")).toBeInTheDocument();
  });

  it("renders statistics section after loading", async () => {
    render(<MarketPropertiesModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Statistics")).toBeInTheDocument();
    });
    expect(screen.getByText("Total Trades")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("Unique Traders")).toBeInTheDocument();
    expect(screen.getByText("15")).toBeInTheDocument();
  });

  it("shows error on fetch failure", async () => {
    mockGet.mockRejectedValue(new Error("Forbidden"));
    render(<MarketPropertiesModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Forbidden")).toBeInTheDocument();
    });
  });

  it("does not fetch when closed", () => {
    render(<MarketPropertiesModal {...defaultProps} open={false} />);
    expect(mockGet).not.toHaveBeenCalled();
  });
});
