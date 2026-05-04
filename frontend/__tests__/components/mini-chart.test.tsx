import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MiniChart } from "@/components/market/mini-chart";
import {
  mockBinaryMarket,
  mockMultiMarket,
  mockContinuousMarket,
} from "../helpers/mock-data";

describe("MiniChart", () => {
  it("renders binary market as stacked bar (Yes/No labels)", () => {
    render(<MiniChart market={mockBinaryMarket} />);
    // Binary chart renders text elements with Yes/No percentages
    const svg = document.querySelector("svg");
    expect(svg).toBeTruthy();
    const texts = svg!.querySelectorAll("text");
    const labels = Array.from(texts).map((t) => t.textContent);
    expect(labels.some((l) => l?.includes("Yes"))).toBe(true);
    expect(labels.some((l) => l?.includes("No"))).toBe(true);
  });

  it("renders continuous market as area chart", () => {
    render(<MiniChart market={mockContinuousMarket} />);
    const svg = document.querySelector("svg");
    expect(svg).toBeTruthy();
    // Should have a gradient-filled path and a polyline
    expect(svg!.querySelector("path")).toBeTruthy();
    expect(svg!.querySelector("polyline")).toBeTruthy();
  });

  it("renders continuous market x-axis labels when showAxes is true", () => {
    render(<MiniChart market={mockContinuousMarket} height={80} showAxes />);
    const svg = document.querySelector("svg");
    expect(svg).toBeTruthy();
    const texts = svg!.querySelectorAll("text");
    // Should have 5 x-axis ticks (0, 25, 50, 75, 100)
    expect(texts.length).toBe(5);
  });

  it("renders multi-outcome market as area chart", () => {
    render(<MiniChart market={mockMultiMarket} />);
    const svg = document.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg!.querySelector("path")).toBeTruthy();
    expect(svg!.querySelector("polyline")).toBeTruthy();
  });

  it("uses correct viewBox dimensions", () => {
    render(<MiniChart market={mockBinaryMarket} height={80} />);
    const svg = document.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg!.getAttribute("viewBox")).toBe("0 0 200 80");
  });

  it("returns null for empty probabilities", () => {
    const emptyMarket = {
      ...mockBinaryMarket,
      reserves: [] as string[],
      numOutcomes: 0,
    };
    const { container } = render(<MiniChart market={emptyMarket} />);
    expect(container.innerHTML).toBe("");
  });
});
