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
  computeProbabilities,
  formatUsdc,
  formatProbability,
  timeUntil,
} from "@/lib/types";
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

  const probabilities = computeProbabilities(market.reserves);
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
                        ? `${Number(market.rangeMin).toLocaleString()} – ${Number(market.rangeMax).toLocaleString()}`
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
                          ? Number(market.resolvedValue).toLocaleString()
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

        {/* Right column: Trading panel placeholder */}
        <div className="space-y-6 lg:sticky lg:top-20 lg:self-start">
          <Card className="border-primary/20">
            <CardHeader className="pb-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Trade
              </h2>
            </CardHeader>
            <CardContent>
              <div className="flex h-48 flex-col items-center justify-center rounded-lg border border-dashed border-border/60 text-center">
                <p className="text-sm text-muted-foreground">
                  Trading panel coming soon
                </p>
                <p className="mt-1 text-xs text-muted-foreground/60">
                  Buy and sell outcome shares
                </p>
              </div>
            </CardContent>
          </Card>

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
    const rMin = market.rangeMin != null ? Number(market.rangeMin) : 0;
    const rMax = market.rangeMax != null ? Number(market.rangeMax) : 100;
    const resolved =
      market.state === MarketState.Resolved && market.resolvedValue != null
        ? Number(market.resolvedValue)
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
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

function TruncatedAddress({ address }: { address: string }) {
  if (address.length <= 12) return <span className="font-mono text-xs">{address}</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help font-mono text-xs">
          {address.slice(0, 4)}...{address.slice(-4)}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <span className="font-mono text-xs">{address}</span>
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
    <div className="text-center">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`mt-0.5 text-sm font-semibold ${highlight ? "text-destructive" : ""}`}
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
