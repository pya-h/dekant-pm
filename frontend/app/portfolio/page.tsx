"use client";

import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useUserPositions } from "@/hooks/use-positions";
import { useBookmarkedMarkets } from "@/hooks/use-bookmarks";
import { Button } from "@/components/ui/button";
import { MarketCard } from "@/components/market/market-card";
import {
  MarketState,
  SCALE,
  type UserPosition,
} from "@/lib/types";
import {
  categorizePositions,
  computePortfolioValue,
  computeActivePositionCount,
  computeWinRate,
  computeTotalAtRisk,
  computeMaxPotentialGain,
  computeMaxPotentialLoss,
  computeOverlappingPositions,
  computeAvgWinProbability,
  computeCurrentValue,
  computePnl,
  computePositionWinProb,
  getPositionRange,
  formatCompactUsdc,
  formatRangeValue,
} from "@/lib/portfolio-utils";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useState } from "react";
import { Wallet, TrendingUp, AlertCircle, AlertTriangle } from "lucide-react";

type TabKey = "all" | "open" | "settled" | "expired" | "bookmarked";

export default function PortfolioPage() {
  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const [activeTab, setActiveTab] = useState<TabKey>("all");

  const address = publicKey?.toBase58();
  const { data: positions, isLoading, isError, error, refetch } = useUserPositions(address);
  const {
    data: bookmarkedMarkets,
    isLoading: bookmarkedLoading,
    isError: isBookmarkedError,
    error: bookmarkedError,
    refetch: refetchBookmarked,
  } = useBookmarkedMarkets(address, activeTab === "bookmarked");

  const tabs = useMemo(() => {
    if (!positions) return { all: [], open: [], settled: [], expired: [] };
    return categorizePositions(positions);
  }, [positions]);

  const stats = useMemo(() => {
    const portfolioValue = computePortfolioValue(tabs.all);
    const activeCount = computeActivePositionCount(tabs.open, tabs.expired);
    const winRate = computeWinRate(tabs.settled);
    const totalAtRisk = computeTotalAtRisk(tabs.open, tabs.expired);
    const maxGain = computeMaxPotentialGain(tabs.open, tabs.expired);
    const maxLoss = computeMaxPotentialLoss(tabs.open, tabs.expired);
    const overlapping = computeOverlappingPositions([...tabs.open, ...tabs.expired]);
    const avgWinProb = computeAvgWinProbability(tabs.open, tabs.expired);
    return { portfolioValue, activeCount, winRate, totalAtRisk, maxGain, maxLoss, overlapping, avgWinProb };
  }, [tabs]);

  if (!connected) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-6 text-center">
          <div className="rounded-full bg-muted p-4">
            <Wallet className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Connect your wallet</h1>
            <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
              Connect your Solana wallet to view your prediction market positions, unrealized PnL, and claim payouts.
            </p>
          </div>
          <Button size="lg" onClick={() => setVisible(true)} className="gap-2">
            <Wallet className="h-4 w-4" />
            Connect Wallet
          </Button>
        </div>
      </div>
    );
  }

  const currentPositions = activeTab === "bookmarked" ? [] : tabs[activeTab];

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
      {/* ── Header: Title + Stats ── */}
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Portfolio</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Probability exposure dashboard &middot; Last updated just now
          </p>
        </div>

        {!isLoading && !isError && positions && positions.length > 0 && (
          <div className="flex items-stretch gap-px rounded-lg border border-border/30 bg-muted/10 overflow-hidden shrink-0">
            <HeaderStat
              value={formatCompactUsdc(stats.portfolioValue)}
              label="Portfolio Value"
            />
            <div className="w-px bg-border/30" />
            <HeaderStat
              value={String(stats.activeCount).padStart(2, "0")}
              label="Active Positions"
            />
            <div className="w-px bg-border/30" />
            <HeaderStat
              value={`${Math.round(stats.winRate * 100)}%`}
              label="Win Rate"
            />
          </div>
        )}
      </div>

      {/* ── Content ── */}
      {isLoading ? (
        <PortfolioSkeleton />
      ) : isError ? (
        <div className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
          <AlertCircle className="mx-auto mb-2 h-6 w-6 text-destructive" />
          <p className="text-sm text-destructive">
            Failed to load positions
            {error instanceof Error ? `: ${error.message}` : ""}
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          {/* ── Tabs ── */}
          <div className="mt-6 flex items-center gap-6 border-b border-border/30">
            {(["all", "open", "settled", "expired", "bookmarked"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "pb-2.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px",
                  activeTab === tab
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground/80",
                )}
              >
                {tab === "all" ? "All" : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {activeTab === "bookmarked" ? (
            <div className="mt-4">
              {bookmarkedLoading ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-44 animate-pulse rounded-xl border bg-card/50"
                    />
                  ))}
                </div>
              ) : isBookmarkedError ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
                  <AlertCircle className="mx-auto mb-2 h-6 w-6 text-destructive" />
                  <p className="text-sm text-destructive">
                    Failed to load bookmarked markets
                    {bookmarkedError instanceof Error ? `: ${bookmarkedError.message}` : ""}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => refetchBookmarked()}
                  >
                    Retry
                  </Button>
                </div>
              ) : !bookmarkedMarkets || bookmarkedMarkets.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/40 p-12 text-center">
                  <p className="text-sm text-muted-foreground">
                    No bookmarked markets yet
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {bookmarkedMarkets.map((market) => (
                    <MarketCard key={market.id} market={market} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* ── Main grid: position list + risk sidebar ── */
            <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_280px]">
              {/* Position list */}
              <div>
                {currentPositions.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border/40 p-12 text-center">
                    <p className="text-sm text-muted-foreground">
                      No positions in this category
                    </p>
                  </div>
                ) : (
                  <div className="space-y-0">
                    {currentPositions.map((pos) => (
                      <PositionRow key={pos.id} position={pos} />
                    ))}
                  </div>
                )}
              </div>

              {/* Risk Summary sidebar */}
              <div className="lg:sticky lg:top-16 lg:self-start">
                <RiskSummary stats={stats} undecided={[...tabs.open, ...tabs.expired]} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Header stat box ──

function HeaderStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-5 py-3 text-center">
      <div className="text-lg font-bold tabular-nums leading-tight">{value}</div>
      <div className="text-[11px] text-muted-foreground whitespace-nowrap">{label}</div>
    </div>
  );
}

// ── Position row ──

function PositionRow({ position }: { position: UserPosition }) {
  const { market } = position;
  const { pnl, pnlPct } = computePnl(position);
  const currentValue = computeCurrentValue(position);
  const winProb = computePositionWinProb(position);
  const deposited = Number(position.totalDeposited);
  const range = getPositionRange(position);

  const deadline = new Date(market.deadline);
  const isResolved = market.state === MarketState.Resolved;
  const isPastDeadline = deadline.getTime() < Date.now();

  // Settlement date display
  const settlementStr = deadline.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  // Position entry date (updatedAt as approximation)
  const entryDate = new Date(position.updatedAt);
  const entryStr = entryDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  // Status badge
  let statusLabel: string;
  let statusClass: string;
  if (isResolved) {
    statusLabel = "resolved";
    statusClass = "border-muted-foreground/30 bg-muted/20 text-muted-foreground";
  } else if (isPastDeadline) {
    statusLabel = "Expired";
    statusClass = "border-amber-500/30 bg-amber-500/10 text-amber-400";
  } else {
    statusLabel = "Open";
    statusClass = "border-emerald-500/30 bg-emerald-500/10 text-emerald-400";
  }

  // Range display for continuous markets
  let rangeDisplay: string | null = null;
  let rangeFraction = 0;
  if (range) {
    rangeDisplay = `${formatRangeValue(range.min)} \u2192 ${formatRangeValue(range.max)}`;
    // Fraction of total range covered
    const rMin = Number(market.rangeMin!) / SCALE;
    const rMax = Number(market.rangeMax!) / SCALE;
    const totalRange = rMax - rMin;
    if (totalRange > 0) {
      rangeFraction = Math.min((range.max - range.min) / totalRange, 1);
    }
  }

  return (
    <Link
      href={`/markets/${market.id}`}
      className="flex items-center gap-4 rounded-lg border border-border/20 bg-card/30 px-4 py-3.5 transition-colors hover:bg-card/60 hover:border-border/40 mb-2"
    >
      {/* Icon */}
      <div className="h-10 w-10 shrink-0 rounded-full bg-muted/40 flex items-center justify-center">
        <TrendingUp className="h-4 w-4 text-muted-foreground" />
      </div>

      {/* Market title + settlement */}
      <div className="min-w-0 flex-1 max-w-[200px]">
        <div className="truncate text-sm font-medium leading-snug">
          {market.title}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {settlementStr} settlement
        </div>
      </div>

      {/* Range (continuous) or outcome */}
      <div className="w-[130px] shrink-0 hidden md:block">
        {rangeDisplay ? (
          <div>
            <div className="text-sm font-medium tabular-nums">{rangeDisplay}</div>
            <div className="mt-1 h-1 w-full rounded-full bg-muted/30 overflow-hidden">
              <div
                className="h-full rounded-full bg-muted-foreground/40"
                style={{ width: `${Math.max(rangeFraction * 100, 8)}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">-</div>
        )}
      </div>

      {/* Cost */}
      <div className="w-[100px] shrink-0 text-right hidden sm:block">
        <div className="text-sm font-medium tabular-nums">
          {formatCompactUsdc(deposited)}
        </div>
        <div className="text-[11px] text-muted-foreground">{entryStr}</div>
      </div>

      {/* Current value */}
      <div className="w-[100px] shrink-0 text-right hidden sm:block">
        <div className="text-sm font-medium tabular-nums">
          {formatCompactUsdc(currentValue)}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {Math.round(winProb * 100)}% win prob
        </div>
      </div>

      {/* PnL */}
      <div className="w-[100px] shrink-0 text-right">
        <div
          className={cn(
            "text-sm font-semibold tabular-nums",
            pnl >= 0 ? "text-emerald-400" : "text-rose-400",
          )}
        >
          {pnl >= 0 ? "+" : "-"}{formatCompactUsdc(Math.abs(pnl))}
        </div>
        <div
          className={cn(
            "text-[11px] tabular-nums",
            pnl >= 0 ? "text-emerald-400/70" : "text-rose-400/70",
          )}
        >
          {pnl >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%
        </div>
      </div>

      {/* Status badge */}
      <div className="w-[80px] shrink-0 flex justify-end">
        <span
          className={cn(
            "inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium",
            statusClass,
          )}
        >
          {statusLabel}
        </span>
      </div>
    </Link>
  );
}

// ── Risk Summary sidebar ──

function RiskSummary({
  stats,
  undecided,
}: {
  stats: {
    totalAtRisk: number;
    maxGain: number;
    maxLoss: number;
    overlapping: number;
    avgWinProb: number;
  };
  undecided: UserPosition[];
}) {
  return (
    <div className="rounded-lg border border-border/30 bg-card/30 p-5">
      <h3 className="text-sm font-semibold">Risk Summary</h3>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Distribution-based range bet
      </p>

      <div className="mt-4 space-y-3">
        <RiskRow label="Total at Risk" value={formatCompactUsdc(stats.totalAtRisk)} />
        <RiskRow
          label="Max Potential Gain"
          value={`+${formatCompactUsdc(stats.maxGain)}`}
          valueClass="text-emerald-400"
        />
        <RiskRow
          label="Max Potential Loss"
          value={`-${formatCompactUsdc(stats.maxLoss)}`}
          valueClass="text-rose-400"
        />
        <RiskRow
          label="Overlapping Positions"
          value={`${stats.overlapping} pairs`}
        />
        <RiskRow
          label="Avg Win Probability"
          value={`${Math.round(stats.avgWinProb * 100)}%`}
        />
      </div>

      {/* Overlapping warning */}
      {stats.overlapping > 0 && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-border/20 bg-muted/10 px-3 py-2.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {stats.overlapping} position pairs share overlapping price ranges &mdash; correlated risk.
          </p>
        </div>
      )}
    </div>
  );
}

function RiskRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-sm font-medium tabular-nums", valueClass)}>
        {value}
      </span>
    </div>
  );
}

// ── Skeleton ──

function PortfolioSkeleton() {
  return (
    <div className="mt-6 space-y-6">
      {/* Tab skeleton */}
      <div className="flex gap-6 border-b border-border/30 pb-2.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-4 w-16 animate-pulse rounded bg-muted" />
        ))}
      </div>

      {/* Grid skeleton */}
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-lg bg-muted/30"
              style={{ animationDelay: `${i * 80}ms`, animationFillMode: "backwards" }}
            />
          ))}
        </div>
        <div className="h-[300px] animate-pulse rounded-lg bg-muted/30" />
      </div>
    </div>
  );
}
