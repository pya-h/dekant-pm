import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarketCard } from "@/components/market/market-card";
import {
  mockBinaryMarket,
  mockMultiMarket,
  mockContinuousMarket,
  mockResolvedMarket,
} from "../helpers/mock-data";

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
  it("renders market title", () => {
    render(<MarketCard market={mockBinaryMarket} />);
    expect(screen.getByText("Will BTC reach $100k?")).toBeInTheDocument();
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
    render(<MarketCard market={mockMultiMarket} />);
    expect(screen.getByText("Who wins the election?")).toBeInTheDocument();
  });

  it("renders continuous market", () => {
    render(<MarketCard market={mockContinuousMarket} />);
    expect(screen.getByText("What will BTC price be?")).toBeInTheDocument();
  });

  it("renders resolved market", () => {
    render(<MarketCard market={mockResolvedMarket} />);
    expect(screen.getByText("Will BTC reach $100k?")).toBeInTheDocument();
  });
});
