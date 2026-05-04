import { describe, it, expect } from "vitest";
import { getMarketAssetVisual } from "@/lib/market-asset";

describe("getMarketAssetVisual", () => {
  it("returns known asset visual for BTC", () => {
    const result = getMarketAssetVisual("BTC", null);
    expect(result.symbol).toBe("₿");
    expect(result.bgClass).toContain("amber");
    expect(result.textClass).toContain("amber");
    expect(result.imageSrc).toBeNull();
    expect(result.asset).toBe("BTC");
  });

  it("returns known asset visual for ETH (case-insensitive)", () => {
    const result = getMarketAssetVisual("eth", null);
    expect(result.symbol).toBe("Ξ");
    expect(result.asset).toBe("ETH");
  });

  it("returns known asset visual for SOL", () => {
    const result = getMarketAssetVisual("SOL", null);
    expect(result.symbol).toBe("◎");
    expect(result.bgClass).toContain("fuchsia");
  });

  it("returns default visual for unknown subject", () => {
    const result = getMarketAssetVisual("UNKNOWN_TOKEN", null);
    expect(result.symbol).toBe("◉");
    expect(result.bgClass).toBe("bg-muted");
    expect(result.textClass).toBe("text-muted-foreground");
    expect(result.imageSrc).toBeNull();
    expect(result.asset).toBe("UNKNOWN_TOKEN");
  });

  it("returns default visual for null subject", () => {
    const result = getMarketAssetVisual(null, null);
    expect(result.symbol).toBe("◉");
    expect(result.asset).toBe("");
  });

  it("uses image URL when icon is an HTTP URL", () => {
    const result = getMarketAssetVisual("BTC", "https://example.com/icon.png");
    expect(result.imageSrc).toBe("https://example.com/icon.png");
    // Should still get BTC colors
    expect(result.bgClass).toContain("amber");
  });

  it("uses image URL when icon starts with /", () => {
    const result = getMarketAssetVisual("SOL", "/images/sol.png");
    expect(result.imageSrc).toBe("/images/sol.png");
  });

  it("uses text icon when icon is not a URL", () => {
    const result = getMarketAssetVisual("BTC", "BIT");
    expect(result.imageSrc).toBeNull();
    expect(result.symbol).toBe("BIT");
  });

  it("truncates text icon to 3 characters and uppercases", () => {
    const result = getMarketAssetVisual(null, "longicon");
    expect(result.symbol).toBe("LON");
  });

  it("handles empty icon string", () => {
    const result = getMarketAssetVisual("ETH", "");
    // Empty icon → ignored, falls through to known asset
    expect(result.symbol).toBe("Ξ");
    expect(result.imageSrc).toBeNull();
  });

  it("handles whitespace-only icon", () => {
    const result = getMarketAssetVisual("ETH", "   ");
    // Trimmed to empty → ignored
    expect(result.symbol).toBe("Ξ");
  });

  it("handles whitespace in subject", () => {
    const result = getMarketAssetVisual("  btc  ", null);
    expect(result.asset).toBe("BTC");
    expect(result.symbol).toBe("₿");
  });

  it("applies known asset colors to image icons", () => {
    const result = getMarketAssetVisual("ETH", "https://img.com/eth.svg");
    expect(result.bgClass).toContain("slate");
    expect(result.imageSrc).toBe("https://img.com/eth.svg");
  });

  it("applies default colors when subject is unknown and icon is image URL", () => {
    const result = getMarketAssetVisual("ZZZZZ", "https://img.com/x.png");
    expect(result.bgClass).toBe("bg-muted");
    expect(result.imageSrc).toBe("https://img.com/x.png");
  });
});
