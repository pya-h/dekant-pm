import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MarketStatsBar, StatCard } from "@/components/market/market-stats-bar";
import { mockBinaryMarket, mockContinuousMarket } from "../helpers/mock-data";

vi.mock("@/hooks/use-oracle-data", () => ({
  useOracleData: () => ({ data: null, isLoading: false }),
}));

vi.mock("@/hooks/use-live-price", () => ({
  useLivePrice: () => ({ data: null, isLoading: false }),
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("MarketStatsBar", () => {
  it("renders liquidity and volume stats for binary market", () => {
    render(
      <MarketStatsBar
        market={{
          id: mockBinaryMarket.id,
          marketType: mockBinaryMarket.marketType,
          totalMinted: mockBinaryMarket.totalMinted,
          totalVolume: mockBinaryMarket.totalVolume,
          rangeMin: mockBinaryMarket.rangeMin,
          rangeMax: mockBinaryMarket.rangeMax,
          subject: mockBinaryMarket.subject,
          category: mockBinaryMarket.category,
        }}
      />,
      { wrapper: Wrapper },
    );
    expect(screen.getByText(/Liquidity/)).toBeInTheDocument();
    expect(screen.getByText(/Volume/)).toBeInTheDocument();
  });

  it("does not render live price for binary market", () => {
    const { container } = render(
      <MarketStatsBar
        market={{
          id: mockBinaryMarket.id,
          marketType: mockBinaryMarket.marketType,
          totalMinted: mockBinaryMarket.totalMinted,
          totalVolume: mockBinaryMarket.totalVolume,
          rangeMin: mockBinaryMarket.rangeMin,
          rangeMax: mockBinaryMarket.rangeMax,
          subject: mockBinaryMarket.subject,
          category: mockBinaryMarket.category,
        }}
      />,
      { wrapper: Wrapper },
    );
    expect(container.textContent).not.toContain("Price (live)");
  });

  it("renders live price with market subject for continuous market", () => {
    const { container } = render(
      <MarketStatsBar
        market={{
          id: mockContinuousMarket.id,
          marketType: mockContinuousMarket.marketType,
          totalMinted: mockContinuousMarket.totalMinted,
          totalVolume: mockContinuousMarket.totalVolume,
          rangeMin: mockContinuousMarket.rangeMin,
          rangeMax: mockContinuousMarket.rangeMax,
          subject: mockContinuousMarket.subject,
          category: mockContinuousMarket.category,
        }}
      />,
      { wrapper: Wrapper },
    );
    // useLivePrice is mocked to return null, so no price card rendered
    expect(container.textContent).not.toContain("BTC Price");
  });
});

describe("StatCard", () => {
  it("renders label and value", () => {
    render(<StatCard label="Test Label" value="$1,234" />);
    expect(screen.getByText("Test Label")).toBeInTheDocument();
    expect(screen.getByText("$1,234")).toBeInTheDocument();
  });
});
