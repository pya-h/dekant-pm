"use client";

import { useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
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
import { MarketState, formatUsdc, type MarketFilters } from "@/lib/types";
import { PlusCircle, ArrowUpDown, SlidersHorizontal } from "lucide-react";

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

interface CreatorDashboardProps {
  /** When embedded in admin panel, hide the outer header */
  embedded?: boolean;
}

export function CreatorDashboard({ embedded = false }: CreatorDashboardProps) {
  const { publicKey } = useWallet();
  const address = publicKey?.toBase58();

  const [stateFilter, setStateFilter] = useState("all");
  const [sortBy, setSortBy] = useState<MarketFilters["sortBy"]>("newest");
  const [page, setPage] = useState(1);
  const limit = 12;

  const { data, isLoading, isError, error, refetch } = useMarkets({
    page,
    limit,
    creator: address,
    ...(stateFilter !== "all" && { state: Number(stateFilter) }),
    sortBy,
    enabled: !!address,
    includeStats: true,
  });

  const totalPages = data ? Math.ceil(data.total / limit) : 0;
  const hasMore = page < totalPages;

  return (
    <div className="space-y-6">
      {/* Header — hidden when embedded in admin tabs */}
      {!embedded && (
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Creator Dashboard
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Create and manage your prediction markets
            </p>
          </div>
          <Link href="/creator/create-market">
            <Button className="gap-2">
              <PlusCircle className="h-4 w-4" />
              Create Market
            </Button>
          </Link>
        </div>
      )}

      {/* Embedded header — compact with create button */}
      {embedded && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Markets created by your wallet
          </p>
          <Link href="/creator/create-market">
            <Button size="sm" className="gap-2">
              <PlusCircle className="h-4 w-4" />
              Create Market
            </Button>
          </Link>
        </div>
      )}

      {/* Summary stats */}
      {data && data.total > 0 && data.stats && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Markets Created" value={String(data.total)} />
          <StatCard
            label="Total Volume"
            value={formatUsdc(data.stats.totalVolume)}
          />
          <StatCard
            label="Total Traders"
            value={String(data.stats.totalTraders)}
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              State
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
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

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <ArrowUpDown className="h-3.5 w-3.5" />
              Sort
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={sortBy}
              onValueChange={(v) => {
                setSortBy(v as MarketFilters["sortBy"]);
                setPage(1);
              }}
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

      {/* Market grid */}
      {isLoading ? (
        <GridSkeleton />
      ) : isError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
          <p className="text-sm text-destructive">
            Failed to load markets
            {error instanceof Error ? `: ${error.message}` : ""}
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
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed p-12 text-center">
          <PlusCircle className="h-8 w-8 text-muted-foreground/40" />
          <div>
            <p className="font-medium">No markets yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create your first prediction market to see it here.
            </p>
          </div>
          <Link href="/creator/create-market">
            <Button variant="outline">Create Market</Button>
          </Link>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.data.map((market) => (
              <MarketCard key={market.id} market={market} />
            ))}
          </div>

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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/40 bg-card/50 p-4 text-center">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-52 animate-pulse rounded-xl border bg-card/50"
          style={{
            animationDelay: `${i * 100}ms`,
            animationFillMode: "backwards",
          }}
        />
      ))}
    </div>
  );
}
