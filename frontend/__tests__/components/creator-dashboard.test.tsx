import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PublicKey } from "@solana/web3.js";
import { CreatorDashboard } from "@/components/creator/creator-dashboard";
import { mockBinaryMarket, mockMultiMarket } from "../helpers/mock-data";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const CREATOR_PUBKEY = new PublicKey(
  "4GYvtbs7da26tLaZt9PNQWLesq2riwEN6fi9tGF91A5P",
);

vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: vi.fn(() => ({
    connected: true,
    publicKey: CREATOR_PUBKEY,
  })),
}));

const mockUseMarkets = vi.fn();
vi.mock("@/hooks/use-markets", () => ({
  useMarkets: (...args: unknown[]) => mockUseMarkets(...args),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CreatorDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes creator address to useMarkets", () => {
    mockUseMarkets.mockReturnValue({
      data: { data: [], total: 0 },
      isLoading: false,
      isError: false,
    });

    render(<CreatorDashboard />);

    expect(mockUseMarkets).toHaveBeenCalledWith(
      expect.objectContaining({
        creator: CREATOR_PUBKEY.toBase58(),
      }),
    );
  });

  it("shows empty state when no markets exist", () => {
    mockUseMarkets.mockReturnValue({
      data: { data: [], total: 0 },
      isLoading: false,
      isError: false,
    });

    render(<CreatorDashboard />);

    expect(screen.getByText("No markets yet")).toBeInTheDocument();
    expect(
      screen.getByText("Create your first prediction market to see it here."),
    ).toBeInTheDocument();
  });

  it("shows loading skeleton when loading", () => {
    mockUseMarkets.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    const { container } = render(<CreatorDashboard />);

    // Skeleton divs have animate-pulse class
    const skeletons = container.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("shows error state with retry button", () => {
    const mockRefetch = vi.fn();
    mockUseMarkets.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("Network failure"),
      refetch: mockRefetch,
    });

    render(<CreatorDashboard />);

    expect(
      screen.getByText(/Failed to load markets.*Network failure/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retry" }),
    ).toBeInTheDocument();
  });

  it("renders market cards when data is present", () => {
    const markets = [
      { ...mockBinaryMarket, creator: CREATOR_PUBKEY.toBase58() },
      { ...mockMultiMarket, creator: CREATOR_PUBKEY.toBase58() },
    ];
    mockUseMarkets.mockReturnValue({
      data: { data: markets, total: 2 },
      isLoading: false,
      isError: false,
    });

    render(<CreatorDashboard />);

    expect(screen.getByText("Will BTC reach $100k?")).toBeInTheDocument();
    expect(screen.getByText("Who wins the election?")).toBeInTheDocument();
  });

  it("shows summary stats when markets exist", () => {
    const markets = [
      { ...mockBinaryMarket, creator: CREATOR_PUBKEY.toBase58() },
    ];
    mockUseMarkets.mockReturnValue({
      data: { data: markets, total: 1 },
      isLoading: false,
      isError: false,
    });

    render(<CreatorDashboard />);

    expect(screen.getByText("Markets Created")).toBeInTheDocument();
    expect(screen.getByText("Total Volume")).toBeInTheDocument();
    expect(screen.getByText("Total Traders")).toBeInTheDocument();
    // total count
    expect(screen.getByText("1")).toBeInTheDocument();
    // 42 traders from mockBinaryMarket
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("shows full header when not embedded", () => {
    mockUseMarkets.mockReturnValue({
      data: { data: [], total: 0 },
      isLoading: false,
      isError: false,
    });

    render(<CreatorDashboard />);

    expect(screen.getByText("Creator Dashboard")).toBeInTheDocument();
  });

  it("hides full header when embedded", () => {
    mockUseMarkets.mockReturnValue({
      data: { data: [], total: 0 },
      isLoading: false,
      isError: false,
    });

    render(<CreatorDashboard embedded />);

    expect(screen.queryByText("Creator Dashboard")).not.toBeInTheDocument();
    expect(
      screen.getByText("Markets created by your wallet"),
    ).toBeInTheDocument();
  });

  it("shows Create Market links pointing to /creator/create-market", () => {
    mockUseMarkets.mockReturnValue({
      data: { data: [], total: 0 },
      isLoading: false,
      isError: false,
    });

    render(<CreatorDashboard />);

    const createLinks = screen.getAllByRole("link", { name: /Create Market/i });
    for (const link of createLinks) {
      expect(link).toHaveAttribute("href", "/creator/create-market");
    }
  });

  it("shows pagination when total exceeds page limit", () => {
    const markets = Array.from({ length: 12 }, (_, i) => ({
      ...mockBinaryMarket,
      id: String(i + 1),
      title: `Market ${i + 1}`,
      creator: CREATOR_PUBKEY.toBase58(),
    }));
    mockUseMarkets.mockReturnValue({
      data: { data: markets, total: 24 },
      isLoading: false,
      isError: false,
    });

    render(<CreatorDashboard />);

    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Previous" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Next" }),
    ).not.toBeDisabled();
  });

  it("does not show pagination for single page", () => {
    mockUseMarkets.mockReturnValue({
      data: { data: [mockBinaryMarket], total: 1 },
      isLoading: false,
      isError: false,
    });

    render(<CreatorDashboard />);

    expect(screen.queryByText(/Page \d+ of \d+/)).not.toBeInTheDocument();
  });
});
