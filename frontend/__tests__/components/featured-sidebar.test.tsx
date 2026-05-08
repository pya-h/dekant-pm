import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FeaturedSidebar } from "@/components/home/featured-sidebar";

describe("FeaturedSidebar", () => {
  it("renders Trending Topics heading", () => {
    render(<FeaturedSidebar />);
    expect(screen.getByText("Trending Topics")).toBeInTheDocument();
  });

  it("renders trending topic names", () => {
    render(<FeaturedSidebar />);
    expect(screen.getByText("CLARITY Act Markup")).toBeInTheDocument();
    expect(screen.getByText("IBIT $1B Inflow Week")).toBeInTheDocument();
    expect(screen.getByText("BTC Reclaims $82K")).toBeInTheDocument();
    expect(screen.getByText("Tokenized Treasuries (ONDO)")).toBeInTheDocument();
    expect(screen.getByText("Hyperliquid Whale Longs")).toBeInTheDocument();
  });

  it("renders numbered rankings for trending topics", () => {
    render(<FeaturedSidebar />);
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });
});
