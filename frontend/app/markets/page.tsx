"use client";

import { useState, useDeferredValue } from "react";
import { useMarkets } from "@/hooks/use-markets";
import { MarketCard } from "@/components/market/market-card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MarketType, MarketState, type MarketFilters } from "@/lib/types";
import { Search, SlidersHorizontal, ArrowUpDown } from "lucide-react";

const typeOptions = [
  { value: "all", label: "All" },
  { value: String(MarketType.Binary), label: "Binary" },
  { value: String(MarketType.MultiOutcome), label: "Multi" },
  { value: String(MarketType.Continuous), label: "Continuous" },
] as const;

const stateOptions = [
  { value: "all", label: "All" },
  { value: String(MarketState.Active), label: "Active" },
  { value: String(MarketState.Paused), label: "Paused" },
  { value: String(MarketState.PendingResolution), label: "Pending" },
  { value: String(MarketState.Resolved), label: "Resolved" },
] as const;

const sortOptions = [
  { value: "newest", label: "Newest" },
  { value: "deadline", label: "Deadline" },
  { value: "volume", label: "Volume" },
] as const;

export default function MarketsPage() {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [typeFilter, setTypeFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [sortBy, setSortBy] = useState<MarketFilters["sortBy"]>("newest");
  const [page, setPage] = useState(1);

  const limit = 20;

  const filters: MarketFilters = {
    ...(typeFilter !== "all" && { marketType: Number(typeFilter) }),
    ...(stateFilter !== "all" && { state: Number(stateFilter) }),
    ...(deferredSearch && { search: deferredSearch }),
    sortBy,
  };

  const { data, isLoading, isError, error } = useMarkets({
    page,
    limit,
    ...filters,
  });

  const totalPages = data ? Math.ceil(data.total / limit) : 0;
  const hasMore = page < totalPages;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Markets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Explore prediction markets and trade on outcomes
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Search */}
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search markets..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-2">
          {/* State filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                State
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={stateFilter}
                onValueChange={(v) => {
                  setStateFilter(v);
                  setPage(1);
                }}
              >
                {stateOptions.map((opt) => (
                  <DropdownMenuRadioItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Sort */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <ArrowUpDown className="h-3.5 w-3.5" />
                Sort
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={sortBy}
                onValueChange={(v) => setSortBy(v as MarketFilters["sortBy"])}
              >
                {sortOptions.map((opt) => (
                  <DropdownMenuRadioItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Type tabs */}
      <Tabs
        value={typeFilter}
        onValueChange={(v) => {
          setTypeFilter(v);
          setPage(1);
        }}
      >
        <TabsList>
          {typeOptions.map((opt) => (
            <TabsTrigger key={opt.value} value={opt.value}>
              {opt.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

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
            onClick={() => window.location.reload()}
          >
            Retry
          </Button>
        </div>
      ) : !data || data.data.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-sm text-muted-foreground">
            {deferredSearch
              ? "No markets match your search"
              : "No markets found"}
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.data.map((market) => (
              <MarketCard key={market.id} market={market} />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasMore}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
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
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-52 animate-pulse rounded-xl border bg-card"
        />
      ))}
    </div>
  );
}
