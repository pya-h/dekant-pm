import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FeaturedSidebar } from "@/components/home/featured-sidebar";

describe("FeaturedSidebar", () => {
  it("renders Market Signals heading", () => {
    render(<FeaturedSidebar />);
    expect(screen.getByText("Market Signals")).toBeInTheDocument();
  });

  it("renders Trending Topics heading", () => {
    render(<FeaturedSidebar />);
    expect(screen.getByText("Trending Topics")).toBeInTheDocument();
  });

  it("renders signal entries", () => {
    render(<FeaturedSidebar />);
    const entries = screen.getAllByText("Whale Entry Detected");
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });

  it("renders trending topic names", () => {
    render(<FeaturedSidebar />);
    expect(screen.getByText("BTC Halving Impact")).toBeInTheDocument();
    expect(screen.getByText("MicroStrategy Holdings")).toBeInTheDocument();
    expect(screen.getByText("BTC ETF Inflows")).toBeInTheDocument();
    expect(screen.getByText("Lightning Network Growth")).toBeInTheDocument();
    expect(screen.getByText("BTC Dominance")).toBeInTheDocument();
  });

  it("renders numbered rankings for trending topics", () => {
    render(<FeaturedSidebar />);
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("renders change percentages with correct sign", () => {
    render(<FeaturedSidebar />);
    expect(screen.getByText(/\+18%/)).toBeInTheDocument();
    expect(screen.getByText(/-11%/)).toBeInTheDocument();
  });
});
