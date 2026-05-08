import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarketCard } from "@/components/market/market-card";
import {
  mockBinaryMarket,
  mockMultiMarket,
  mockContinuousMarket,
  mockResolvedMarket,
} from "../helpers/mock-data";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    token: null,
    isAuthenticated: false,
    isAuthenticating: false,
    authenticate: vi.fn(),
    error: null,
  }),
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

describe("MarketCard", () => {
  it("renders deadline countdown", () => {
    const { container } = render(<MarketCard market={mockBinaryMarket} />);
    // Mock deadline is 1 day from now → shows hrs/mins countdown
    expect(container.textContent).toMatch(/hrs|mins|days/);
  });

  it("links to the market detail page", () => {
    render(<MarketCard market={mockBinaryMarket} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/markets/1");
  });

  it("shows liquidity", () => {
    render(<MarketCard market={mockBinaryMarket} />);
    expect(screen.getByText(/Liquidity/)).toBeInTheDocument();
  });

  it("shows deadline countdown", () => {
    const { container } = render(<MarketCard market={mockBinaryMarket} />);
    // Deadline is 1 day in future — should render time units
    expect(container.textContent).toMatch(/days|hrs|mins|Expired/);
  });

  it("renders multi-outcome market", () => {
    const { container } = render(<MarketCard market={mockMultiMarket} />);
    expect(container.textContent).toMatch(/hrs|mins|days/);
  });

  it("renders continuous market", () => {
    const { container } = render(<MarketCard market={mockContinuousMarket} />);
    expect(container.textContent).toMatch(/hrs|mins|days/);
  });

  it("renders resolved market", () => {
    const { container } = render(<MarketCard market={mockResolvedMarket} />);
    expect(container.textContent).toMatch(/hrs|mins|days/);
  });

  describe("creator mode", () => {
    it("renders with isCreator prop without errors", () => {
      const { container } = render(
        <MarketCard
          market={mockBinaryMarket}
          isCreator
          onMarketUpdated={vi.fn()}
        />,
      );
      expect(container.textContent).toMatch(/hrs|mins|days/);
    });

    it("still links to the market detail page in creator mode", () => {
      render(
        <MarketCard
          market={mockBinaryMarket}
          isCreator
          onMarketUpdated={vi.fn()}
        />,
      );
      const link = screen.getByRole("link");
      expect(link).toHaveAttribute("href", "/markets/1");
    });

    it("shows liquidity in creator mode", () => {
      render(
        <MarketCard
          market={mockBinaryMarket}
          isCreator
          onMarketUpdated={vi.fn()}
        />,
      );
      expect(screen.getByText(/Liquidity/)).toBeInTheDocument();
    });
  });
});
