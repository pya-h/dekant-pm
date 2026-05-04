"use client";

import { Suspense, useState, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useMarkets } from "@/hooks/use-markets";
import { MarketCard } from "@/components/market/market-card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MarketFilters } from "@/lib/types";
import { ChevronDown } from "lucide-react";
import { FeaturedSection } from "@/components/home/featured-section";
import { getMarketAssetVisual } from "@/lib/market-asset";

const timeRangeOptions = [
  { value: "all", label: "All Time" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
] as const;

const assetOptions = [
  { value: "all", label: "All Assets" },
  { value: "BTC", label: "Bitcoin" },
  { value: "ETH", label: "Ethereum" },
  { value: "SOL", label: "Solana" },
  { value: "USDC", label: "USDC" },
  { value: "BNB", label: "BNB" },
  { value: "XRP", label: "XRP" },
  { value: "ADA", label: "Cardano" },
  { value: "DOGE", label: "Dogecoin" },
] as const;

const LIMIT = 20;

function getCreatedAfter(timeRange: string): string | undefined {
  if (timeRange === "all") return undefined;
  const now = Date.now();
  const msMap: Record<string, number> = {
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
  };
  const ms = msMap[timeRange];
  if (!ms) return undefined;
  return new Date(now - ms).toISOString();
}

export default function Home() {
  return (
    <Suspense fallback={<HomePageSkeleton />}>
      <HomeContent />
    </Suspense>
  );
}

function HomePageSkeleton() {
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="h-64 animate-pulse rounded-xl border bg-card/50" />
      <div className="h-8 w-32 animate-pulse rounded bg-card/50" />
      <MarketGridSkeleton />
    </div>
  );
}

function HomeContent() {
  const searchParams = useSearchParams();
  const searchFromUrl = searchParams.get("search") ?? "";

  const [timeRange, setTimeRange] = useState("all");
  const [assetFilter, setAssetFilter] = useState("all");
  const [page, setPage] = useState(1);

  const filters: MarketFilters & { page: number; limit: number } = useMemo(() => ({
    page: 1,
    limit: page * LIMIT,
    ...(searchFromUrl && { search: searchFromUrl }),
    ...(assetFilter !== "all" && { subject: assetFilter }),
    ...(timeRange !== "all" && { createdAfter: getCreatedAfter(timeRange) }),
    sortBy: "newest",
  }), [page, searchFromUrl, assetFilter, timeRange]);

  const { data, isLoading, isError, error, refetch } = useMarkets(filters);

  const totalLoaded = data?.data.length ?? 0;
  const total = data?.total ?? 0;
  const hasMore = totalLoaded < total;

  const loadMore = useCallback(() => {
    setPage((p) => p + 1);
  }, []);

  const timeLabel = timeRangeOptions.find((o) => o.value === timeRange)?.label ?? "All Time";
  const assetLabel = assetOptions.find((o) => o.value === assetFilter)?.label ?? "All Assets";
  const assetVisual = assetFilter !== "all" ? getMarketAssetVisual(assetFilter, null) : null;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      {/* Featured section: slideshow + sidebar */}
      <FeaturedSection />

      {/* Markets header + filters */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight">Markets</h2>

        <div className="flex items-center gap-2">
          {/* Time range filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                {timeLabel}
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={timeRange}
                onValueChange={(v) => {
                  setTimeRange(v);
                  setPage(1);
                }}
              >
                {timeRangeOptions.map((opt) => (
                  <DropdownMenuRadioItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Asset filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                {assetVisual && (
                  <span
                    className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold ${assetVisual.bgClass} ${assetVisual.textClass}`}
                  >
                    {assetVisual.symbol}
                  </span>
                )}
                {assetLabel}
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={assetFilter}
                onValueChange={(v) => {
                  setAssetFilter(v);
                  setPage(1);
                }}
              >
                {assetOptions.map((opt) => {
                  const v = opt.value !== "all" ? getMarketAssetVisual(opt.value, null) : null;
                  return (
                    <DropdownMenuRadioItem key={opt.value} value={opt.value} className="gap-2">
                      {v && (
                        <span
                          className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold ${v.bgClass} ${v.textClass}`}
                        >
                          {v.symbol}
                        </span>
                      )}
                      {opt.label}
                    </DropdownMenuRadioItem>
                  );
                })}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Market grid */}
      {isLoading ? (
        <MarketGridSkeleton />
      ) : isError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
          <p className="text-sm text-destructive">
            Failed to load markets{error instanceof Error ? `: ${error.message}` : ""}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => refetch()}
          >
            Retry
          </Button>
        </div>
      ) : !data || data.data.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-sm text-muted-foreground">
            {searchFromUrl
              ? "No markets match your search"
              : assetFilter !== "all"
                ? `No ${assetLabel} markets found`
                : "No markets found"}
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {data.data.map((market) => (
              <MarketCard key={market.id} market={market} />
            ))}
          </div>

          {/* Load More */}
          {hasMore && (
            <div className="flex justify-center pt-4">
              <Button variant="outline" onClick={loadMore}>
                Load More
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MarketGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="h-44 animate-pulse rounded-xl border bg-card/50"
          style={{ animationDelay: `${i * 80}ms`, animationFillMode: "backwards" }}
        />
      ))}
    </div>
  );
}
