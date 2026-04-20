import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarketCard } from "@/components/market/market-card";
import {
  mockBinaryMarket,
  mockMultiMarket,
  mockContinuousMarket,
  mockResolvedMarket,
  mockUserPosition,
} from "../helpers/mock-data";

// Mock next/link to a plain anchor tag
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
// MarketCard rendering
// ---------------------------------------------------------------------------

describe("MarketCard", () => {
  it("renders market title", () => {
    render(<MarketCard market={mockBinaryMarket} />);
    expect(screen.getByText("Will BTC reach $100k?")).toBeInTheDocument();
  });

  it("links to the market detail page", () => {
    render(<MarketCard market={mockBinaryMarket} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/markets/1");
  });

  it("shows volume", () => {
    render(<MarketCard market={mockBinaryMarket} />);
    // 5000000000 / 1e6 = 5000 → "$5.0K"
    expect(screen.getByText("Vol $5.0K")).toBeInTheDocument();
  });

  it("shows trader count when no user position", () => {
    render(<MarketCard market={mockBinaryMarket} />);
    expect(screen.getByText("42 traders")).toBeInTheDocument();
  });

  it("shows category badge", () => {
    render(<MarketCard market={mockBinaryMarket} />);
    expect(screen.getByText("Crypto")).toBeInTheDocument();
  });

  it("shows deadline", () => {
    render(<MarketCard market={mockBinaryMarket} />);
    // Market expires in ~1 day
    expect(screen.getByText(/left$/)).toBeInTheDocument();
  });

  // ── Binary probability display ────────────────────────────────────

  it("renders binary probabilities (Yes/No)", () => {
    render(<MarketCard market={mockBinaryMarket} />);
    // p0 = (100-30)²/10000 = 0.49 → "49.0%"
    expect(screen.getByText(/Yes\s+49\.0%/)).toBeInTheDocument();
    // No is shown as 1 - 0.49 = 0.51 → "51.0%"
    expect(screen.getByText(/No\s+51\.0%/)).toBeInTheDocument();
  });

  // ── Multi-outcome display ─────────────────────────────────────────

  it("renders top outcome for multi-outcome market", () => {
    render(<MarketCard market={mockMultiMarket} />);
    // reserves [40,60,50], TM=100 → p = [0.36, 0.16, 0.25]
    // Top is Alice at 36.0%
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("36.0%")).toBeInTheDocument();
  });

  // ── Resolved market status ────────────────────────────────────────

  it("renders resolved market correctly", () => {
    render(<MarketCard market={mockResolvedMarket} />);
    expect(screen.getByText("Will BTC reach $100k?")).toBeInTheDocument();
  });

  // ── User position ─────────────────────────────────────────────────

  it("shows 'Held' badge when user has a position", () => {
    render(
      <MarketCard market={mockBinaryMarket} userPosition={mockUserPosition} />,
    );
    expect(screen.getByText("Held")).toBeInTheDocument();
  });

  it("shows PnL instead of trader count when user has a position", () => {
    render(
      <MarketCard market={mockBinaryMarket} userPosition={mockUserPosition} />,
    );
    // Should NOT show trader count
    expect(screen.queryByText("42 traders")).not.toBeInTheDocument();
    // Should show PnL value (+ or - with dollar sign)
    expect(screen.getByText(/[+-]\$\d+\.\d+/)).toBeInTheDocument();
  });
});
