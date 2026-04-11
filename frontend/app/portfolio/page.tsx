"use client";

import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useUserPositions } from "@/hooks/use-positions";
import { PositionCard } from "@/components/portfolio/position-card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  MarketState,
  USDC_DECIMALS,
  computeProbabilities,
  formatUsdc,
  type UserPosition,
} from "@/lib/types";
import { Wallet, TrendingUp, AlertCircle } from "lucide-react";

export default function PortfolioPage() {
  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();

  const address = publicKey?.toBase58();
  const { data: positions, isLoading, isError, error, refetch } = useUserPositions(address);

  // Group positions
  const { active, claimable, past, summary } = useMemo(() => {
    if (!positions) {
      return {
        active: [],
        claimable: [],
        past: [],
        summary: { totalValue: 0, totalPnl: 0, activeCount: 0 },
      };
    }

    // Filter out positions where all holdings are zero
    const nonEmpty = positions.filter((p) =>
      p.holdings.some((h) => Number(h) > 0),
    );

    const act: UserPosition[] = [];
    const claim: UserPosition[] = [];
    const done: UserPosition[] = [];

    let totalValue = 0;
    let totalPnl = 0;

    for (const pos of nonEmpty) {
      const value = computePositionValue(pos);
      const deposited = Number(pos.totalDeposited);
      const withdrawn = Number(pos.totalWithdrawn);
      totalValue += value;
      totalPnl += value - deposited + withdrawn;

      if (pos.claimed) {
        done.push(pos);
      } else if (pos.market.state === MarketState.Resolved) {
        claim.push(pos);
      } else {
        act.push(pos);
      }
    }

    return {
      active: act,
      claimable: claim,
      past: done,
      summary: { totalValue, totalPnl, activeCount: act.length },
    };
  }, [positions]);

  // Not connected
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

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Portfolio</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your prediction market positions
        </p>
      </div>

      {/* Summary stats */}
      {!isLoading && !isError && positions && positions.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <SummaryCard
            label="Portfolio Value"
            value={formatUsdc(summary.totalValue)}
          />
          <SummaryCard
            label="Unrealized PnL"
            value={`${summary.totalPnl >= 0 ? "+" : ""}${formatUsdc(Math.abs(summary.totalPnl))}`}
            highlight={summary.totalPnl}
          />
          <SummaryCard
            label="Active Positions"
            value={String(summary.activeCount)}
          />
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <PortfolioSkeleton />
      ) : isError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
          <AlertCircle className="mx-auto mb-2 h-6 w-6 text-destructive" />
          <p className="text-sm text-destructive">
            Failed to load positions
            {error instanceof Error ? `: ${error.message}` : ""}
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : !positions || (active.length === 0 && claimable.length === 0 && past.length === 0) ? (
        <EmptyPortfolio />
      ) : (
        <Tabs defaultValue={claimable.length > 0 ? "claimable" : "active"}>
          <TabsList>
            <TabsTrigger value="active" className="gap-1.5">
              Active
              {active.length > 0 && (
                <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">
                  {active.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="claimable" className="gap-1.5">
              Claimable
              {claimable.length > 0 && (
                <span className="ml-1 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] tabular-nums text-emerald-400">
                  {claimable.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="past" className="gap-1.5">
              Past
              {past.length > 0 && (
                <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">
                  {past.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="mt-4">
            {active.length === 0 ? (
              <EmptyTabMessage message="No active positions" />
            ) : (
              <PositionGrid positions={active} />
            )}
          </TabsContent>

          <TabsContent value="claimable" className="mt-4">
            {claimable.length === 0 ? (
              <EmptyTabMessage message="No payouts to claim" />
            ) : (
              <PositionGrid positions={claimable} />
            )}
          </TabsContent>

          <TabsContent value="past" className="mt-4">
            {past.length === 0 ? (
              <EmptyTabMessage message="No past positions" />
            ) : (
              <PositionGrid positions={past} />
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PositionGrid({ positions }: { positions: UserPosition[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {positions.map((pos) => (
        <PositionCard key={pos.id} position={pos} />
      ))}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: number;
}) {
  return (
    <div className="rounded-xl border border-border/40 bg-card/50 p-4 text-center">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1 text-lg font-bold tabular-nums ${
          highlight != null
            ? highlight >= 0
              ? "text-emerald-400"
              : "text-rose-400"
            : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function EmptyPortfolio() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed p-12 text-center">
      <TrendingUp className="h-8 w-8 text-muted-foreground/40" />
      <div>
        <p className="font-medium">No positions yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Start trading on prediction markets to see your positions here.
        </p>
      </div>
      <Button variant="outline" asChild>
        <a href="/markets">Explore Markets</a>
      </Button>
    </div>
  );
}

function EmptyTabMessage({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function PortfolioSkeleton() {
  return (
    <div className="space-y-6">
      {/* Summary skeleton */}
      <div className="grid grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-xl border bg-card/50"
            style={{ animationDelay: `${i * 100}ms`, animationFillMode: "backwards" }}
          />
        ))}
      </div>
      {/* Grid skeleton */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-48 animate-pulse rounded-xl border bg-card/50"
            style={{ animationDelay: `${(i + 3) * 100}ms`, animationFillMode: "backwards" }}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

function computePositionValue(pos: UserPosition): number {
  const { market } = pos;
  const holdings = pos.holdings.map((h) => Number(h));
  const probabilities = computeProbabilities(
    market.reserves,
    market.totalMinted,
    market.kSquared,
  );

  if (market.state === MarketState.Resolved) {
    const SCALE = 1_000_000_000;
    if (market.resolvedOutcome != null) {
      return holdings[market.resolvedOutcome] ?? 0;
    }
    if (
      market.resolvedValue != null &&
      market.rangeMin != null &&
      market.rangeMax != null
    ) {
      const resolved = Number(market.resolvedValue) / SCALE;
      const rMin = Number(market.rangeMin) / SCALE;
      const rMax = Number(market.rangeMax) / SCALE;
      const binWidth = (rMax - rMin) / market.numOutcomes;
      const winBin = Math.min(
        Math.floor((resolved - rMin) / binWidth),
        market.numOutcomes - 1,
      );
      return holdings[winBin] ?? 0;
    }
    return 0;
  }

  let value = 0;
  for (let i = 0; i < holdings.length; i++) {
    value += holdings[i] * (probabilities[i] ?? 0);
  }
  return value;
}
