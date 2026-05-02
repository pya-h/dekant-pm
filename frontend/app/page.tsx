"use client";

import { Suspense, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useMarkets } from "@/hooks/use-markets";
import { MarketCard } from "@/components/market/market-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MarketFilters } from "@/lib/types";
import { ChevronDown } from "lucide-react";

const timeRangeOptions = [
  { value: "all", label: "All Time" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
] as const;

const LIMIT = 20;

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
  const [page, setPage] = useState(1);

  const filters: MarketFilters & { page: number; limit: number } = {
    page: 1,
    limit: page * LIMIT,
    ...(searchFromUrl && { search: searchFromUrl }),
    sortBy: "newest",
  };

  const { data, isLoading, isError, error, refetch } = useMarkets(filters);

  const totalLoaded = data?.data.length ?? 0;
  const total = data?.total ?? 0;
  const hasMore = totalLoaded < total;

  const loadMore = useCallback(() => {
    setPage((p) => p + 1);
  }, []);

  const timeLabel = timeRangeOptions.find((o) => o.value === timeRange)?.label ?? "All Time";

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      {/* Featured section placeholder */}
      <section className="rounded-xl border border-border/40 bg-muted/10 p-8">
        <div className="flex items-center justify-center text-sm text-muted-foreground h-48">
          Featured section — coming soon
        </div>
      </section>

      {/* Markets header + filters */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight">Markets</h2>

        <div className="flex items-center gap-2">
          {/* Time range filter */}
          <span className="hidden text-sm text-muted-foreground sm:inline">Time range</span>
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

          {/* Assets filter placeholder */}
          <Badge variant="outline" className="gap-1 text-xs cursor-default">
            Assets
          </Badge>
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
