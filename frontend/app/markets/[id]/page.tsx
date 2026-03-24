"use client";

import { use } from "react";
import Link from "next/link";
import { useMarket } from "@/hooks/use-market";
import { MarketStatus } from "@/components/market/market-status";
import { MarketTypeBadge } from "@/components/market/market-type-badge";
import { PriceBar } from "@/components/market/price-bar";
import { DistributionChart } from "@/components/market/distribution-chart";
import {
  MarketType,
  MarketState,
  SCALE,
  computeProbabilities,
  formatUsdc,
  formatProbability,
  timeUntil,
} from "@/lib/types";
import { TradingPanel } from "@/components/trading/trading-panel";
import { LiquidityPanel } from "@/components/liquidity/liquidity-panel";
import { UserPositionDisplay } from "@/components/trading/user-position-display";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export default function MarketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: market, isLoading, error } = useMarket(id);

  if (isLoading) return <MarketDetailSkeleton />;

  if (error || !market) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
          <h2 className="text-lg font-semibold">Market not found</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {error?.message ?? "This market does not exist or could not be loaded."}
          </p>
          <Button variant="outline" className="mt-4" asChild>
            <Link href="/markets">Back to Markets</Link>
          </Button>
        </div>
      </div>
    );
  }

  const probabilities = computeProbabilities(market.reserves, market.totalMinted, market.kSquared);
  const labels =
    market.outcomeLabels ??
    Array.from({ length: market.numOutcomes }, (_, i) => `Outcome ${i + 1}`);
  const deadlineDate = new Date(market.deadline);
  const isExpired = deadlineDate.getTime() < Date.now();

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link href="/markets" className="hover:text-foreground transition-colors">
          Markets
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{market.title}</span>
      </nav>

      {/* Two-column layout */}
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* Left column: Info + Chart */}
        <div className="space-y-6">
          {/* Header card */}
          <Card>
            <CardHeader className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <MarketTypeBadge type={market.marketType} />
                <MarketStatus state={market.state} />
                {market.category && (
                  <Badge
                    variant="outline"
                    className="text-[11px] border-zinc-500/30 bg-zinc-500/10 text-zinc-400"
                  >
                    {market.category}
                  </Badge>
                )}
              </div>
              <h1 className="text-xl font-bold leading-tight lg:text-2xl">
                {market.title}
              </h1>
              {market.description && (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {market.description}
                </p>
              )}
            </CardHeader>
          </Card>

          {/* Probability / Distribution */}
          <Card>
            <CardHeader className="pb-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {market.marketType === MarketType.Continuous
                  ? "Market Distribution"
                  : "Probabilities"}
              </h2>
            </CardHeader>
            <CardContent>
              <ProbabilitySection
                market={market}
                probabilities={probabilities}
                labels={labels}
              />
            </CardContent>
          </Card>

          {/* User position (only shows when wallet connected & has holdings) */}
          <UserPositionDisplay market={market} />

          {/* Market details table */}
          <Card>
            <CardHeader className="pb-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Market Details
              </h2>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 sm:grid-cols-2">
                <DetailRow label="Deadline">
                  <span className={isExpired ? "text-destructive" : ""}>
                    {deadlineDate.toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    ({timeUntil(market.deadline)})
                  </span>
                </DetailRow>

                <DetailRow label="Status">
                  <MarketStatus state={market.state} />
                </DetailRow>

                <DetailRow label="Volume">
                  {formatUsdc(market.totalVolume)}
                </DetailRow>

                <DetailRow label="Traders">
                  {market.totalTraders}
                </DetailRow>

                <DetailRow label="Oracle">
                  <TruncatedAddress address={market.oracle} />
                </DetailRow>

                <DetailRow label="Creator">
                  <TruncatedAddress address={market.creator} />
                </DetailRow>

                <DetailRow label="Collateral">
                  <TruncatedAddress address={market.collateralMint} />
                </DetailRow>

                <DetailRow label="Market Address">
                  <TruncatedAddress address={market.pubkey} />
                </DetailRow>

                {market.marketType === MarketType.Continuous && (
                  <>
                    <DetailRow label="Range">
                      {market.rangeMin != null && market.rangeMax != null
                        ? `${(Number(market.rangeMin) / SCALE).toLocaleString()} – ${(Number(market.rangeMax) / SCALE).toLocaleString()}`
                        : "N/A"}
                    </DetailRow>
                    <DetailRow label="Bins">
                      {market.numOutcomes}
                    </DetailRow>
                  </>
                )}

                {market.state === MarketState.Resolved && (
                  <DetailRow label="Resolved Outcome">
                    <span className="font-medium text-emerald-400">
                      {market.marketType === MarketType.Continuous
                        ? market.resolvedValue != null
                          ? (Number(market.resolvedValue) / SCALE).toLocaleString()
                          : "N/A"
                        : market.resolvedOutcome != null
                          ? labels[market.resolvedOutcome]
                          : "N/A"}
                    </span>
                  </DetailRow>
                )}

                {market.lastTradeAt && (
                  <DetailRow label="Last Trade">
                    {new Date(market.lastTradeAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </DetailRow>
                )}

                {market.tags && market.tags.length > 0 && (
                  <div className="sm:col-span-2">
                    <dt className="mb-1 text-xs text-muted-foreground">Tags</dt>
                    <dd className="flex flex-wrap gap-1.5">
                      {market.tags.map((tag) => (
                        <Badge
                          key={tag}
                          variant="outline"
                          className="text-[11px]"
                        >
                          {tag}
                        </Badge>
                      ))}
                    </dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>
        </div>

        {/* Right column: Trading panel + stats */}
        <div className="space-y-6 lg:sticky lg:top-20 lg:self-start">
          <TradingPanel market={market} />

          {/* Liquidity provision */}
          <div className="flex items-center justify-between rounded-lg border border-border/30 bg-muted/10 px-4 py-3">
            <div>
              <div className="text-xs font-medium">Liquidity Provision</div>
              <div className="text-[11px] text-muted-foreground">
                Earn fees by providing liquidity
              </div>
            </div>
            <LiquidityPanel market={market} />
          </div>

          {/* Quick stats */}
          <Card>
            <CardContent className="grid grid-cols-2 gap-4 pt-6">
              <QuickStat label="Volume" value={formatUsdc(market.totalVolume)} />
              <QuickStat label="Traders" value={String(market.totalTraders)} />
              <QuickStat label="Outcomes" value={String(market.numOutcomes)} />
              <QuickStat
                label="Time Left"
                value={timeUntil(market.deadline)}
                highlight={isExpired}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProbabilitySection({
  market,
  probabilities,
  labels,
}: {
  market: { marketType: MarketType; rangeMin: string | null; rangeMax: string | null; numOutcomes: number; resolvedValue: string | null; state: MarketState };
  probabilities: number[];
  labels: string[];
}) {
  if (probabilities.length === 0) {
    return <p className="text-sm text-muted-foreground">No data available.</p>;
  }

  if (market.marketType === MarketType.Continuous) {
    const rMin = market.rangeMin != null ? Number(market.rangeMin) / SCALE : 0;
    const rMax = market.rangeMax != null ? Number(market.rangeMax) / SCALE : 100;
    const resolved =
      market.state === MarketState.Resolved && market.resolvedValue != null
        ? Number(market.resolvedValue) / SCALE
        : null;

    return (
      <DistributionChart
        probabilities={probabilities}
        rangeMin={rMin}
        rangeMax={rMax}
        numBins={market.numOutcomes}
        resolvedValue={resolved}
        height={220}
      />
    );
  }

  return (
    <PriceBar
      probabilities={probabilities}
      labels={labels}
      variant={market.marketType === MarketType.Binary ? "binary" : "multi"}
    />
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/30 bg-muted/10 px-3 py-2.5">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  );
}

function TruncatedAddress({ address }: { address: string }) {
  const handleCopy = () => {
    navigator.clipboard.writeText(address).then(() => {
      const toast = (window as { __sonnerToast?: (msg: string) => void }).__sonnerToast;
      if (toast) toast("Address copied");
    }).catch(() => {});
  };

  if (address.length <= 12) {
    return (
      <button onClick={handleCopy} className="font-mono text-xs hover:text-primary transition-colors cursor-copy">
        {address}
      </button>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button onClick={handleCopy} className="font-mono text-xs hover:text-primary transition-colors cursor-copy">
          {address.slice(0, 4)}...{address.slice(-4)}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <span className="font-mono text-xs">{address}</span>
        <span className="ml-2 text-[10px] text-muted-foreground">click to copy</span>
      </TooltipContent>
    </Tooltip>
  );
}

function QuickStat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg bg-muted/30 p-3 text-center">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div
        className={`mt-1 text-sm font-bold tabular-nums ${highlight ? "text-destructive" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function MarketDetailSkeleton() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 h-4 w-48 animate-pulse rounded bg-muted" />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {/* Header skeleton */}
          <Card>
            <CardHeader className="space-y-4">
              <div className="flex gap-2">
                <div className="h-5 w-16 animate-pulse rounded bg-muted" />
                <div className="h-5 w-14 animate-pulse rounded bg-muted" />
              </div>
              <div className="h-7 w-3/4 animate-pulse rounded bg-muted" />
              <div className="space-y-2">
                <div className="h-4 w-full animate-pulse rounded bg-muted" />
                <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              </div>
            </CardHeader>
          </Card>
          {/* Chart skeleton */}
          <Card>
            <CardHeader className="pb-2">
              <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            </CardHeader>
            <CardContent>
              <div className="h-48 w-full animate-pulse rounded bg-muted" />
            </CardContent>
          </Card>
          {/* Details skeleton */}
          <Card>
            <CardHeader className="pb-2">
              <div className="h-4 w-28 animate-pulse rounded bg-muted" />
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i}>
                    <div className="h-3 w-16 animate-pulse rounded bg-muted" />
                    <div className="mt-1 h-4 w-32 animate-pulse rounded bg-muted" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
        {/* Right column skeleton */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-2">
              <div className="h-4 w-12 animate-pulse rounded bg-muted" />
            </CardHeader>
            <CardContent>
              <div className="h-48 animate-pulse rounded bg-muted" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
