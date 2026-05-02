"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useTopMarkets } from "@/hooks/use-top-markets";
import { useOracleData } from "@/hooks/use-oracle-data";
import { DistributionChart } from "@/components/market/distribution-chart";
import { PriceBar } from "@/components/market/price-bar";
import {
  MarketType,
  MarketState,
  SCALE,
  computeProbabilities,
  formatUsdc,
  type MarketSummary,
} from "@/lib/types";
import { BarChart3, ChevronLeft, ChevronRight, Heart, Share2, Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";

export function MarketSlideshow() {
  const { data, isLoading } = useTopMarkets();
  const [currentIndex, setCurrentIndex] = useState(0);

  const markets = data?.data ?? [];

  // Clamp index if markets list shrank after a refetch
  const safeIndex = markets.length > 0 ? Math.min(currentIndex, markets.length - 1) : 0;

  const prev = useCallback(() => {
    setCurrentIndex((i) => (i === 0 ? markets.length - 1 : i - 1));
  }, [markets.length]);

  const next = useCallback(() => {
    setCurrentIndex((i) => (i === markets.length - 1 ? 0 : i + 1));
  }, [markets.length]);

  if (isLoading) {
    return <SlideshowSkeleton />;
  }

  if (markets.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-border/40 bg-muted/10 p-12">
        <p className="text-sm text-muted-foreground">No markets available</p>
      </div>
    );
  }

  const market = markets[safeIndex];

  return (
    <div className="flex flex-col gap-3">
      <SlideContent market={market} />

      {/* Navigation */}
      {markets.length > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={prev}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-1.5">
            {markets.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentIndex(i)}
                className={`h-2 rounded-full transition-all ${
                  i === safeIndex
                    ? "w-6 bg-primary"
                    : "w-2 bg-muted-foreground/30 hover:bg-muted-foreground/50"
                }`}
              />
            ))}
          </div>
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={next}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function SlideContent({ market }: { market: MarketSummary }) {
  const probabilities = computeProbabilities(market.reserves, market.totalMinted, market.kSquared);
  const labels =
    market.outcomeLabels ??
    Array.from({ length: market.numOutcomes }, (_, i) => `Outcome ${i + 1}`);

  const isContinuous = market.marketType === MarketType.Continuous;
  const { data: oracleData } = useOracleData(market.id, isContinuous);

  const deadline = new Date(market.deadline);
  const countdown = deadlineCountdown(deadline);
  const liquidity = market.reserves.reduce((sum, r) => sum + Number(r), 0);

  return (
    <div className="rounded-xl border border-border/40 bg-card/50 p-5">
      {/* Title row + action buttons */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="shrink-0 rounded-lg bg-muted p-2.5">
            <BarChart3 className="h-5 w-5 text-cyan-400" />
          </div>
          <h3 className="text-lg font-semibold leading-snug">{market.title}</h3>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
            <Heart className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
            <Share2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
            <Bookmark className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap items-stretch gap-2 mb-4">
        {/* Oracle data — continuous markets only */}
        {isContinuous && oracleData?.distributionPeak != null && (
          <StatCard
            label="Distribution Peak"
            value={formatStatValue(oracleData.distributionPeak)}
          />
        )}
        {isContinuous && oracleData?.mostLikelyRange != null && (
          <StatCard
            label="Most Likely Range"
            value={`${formatStatValue(oracleData.mostLikelyRange[0])} – ${formatStatValue(oracleData.mostLikelyRange[1])}`}
          />
        )}
        {isContinuous && oracleData?.confidence95 != null && (
          <StatCard
            label="95% Confidence"
            value={`${formatStatValue(oracleData.confidence95[0])} – ${formatStatValue(oracleData.confidence95[1])}`}
          />
        )}

        <StatCard label="Liquidity" value={formatUsdc(liquidity)} />
        <StatCard label="Volume" value={formatUsdc(market.totalVolume)} />

        {/* Countdown */}
        {countdown ? (
          <div className="flex items-center gap-3 rounded-lg border border-border/30 bg-muted/20 px-3 py-2">
            {countdown.days > 0 && (
              <CountdownUnit value={countdown.days} label="Days" />
            )}
            <CountdownUnit value={countdown.hours} label="Hours" />
            <CountdownUnit value={countdown.minutes} label="Minutes" />
          </div>
        ) : (
          <div className="flex items-center rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2">
            <span className="text-sm font-semibold text-rose-400">Expired</span>
          </div>
        )}
      </div>

      {/* Chart — clickable to market detail */}
      <Link href={`/markets/${market.id}`} className="block rounded-lg hover:ring-1 hover:ring-primary/30 transition-all">
        <SlideChart
          market={market}
          probabilities={probabilities}
          labels={labels}
        />
      </Link>
    </div>
  );
}

function SlideChart({
  market,
  probabilities,
  labels,
}: {
  market: MarketSummary;
  probabilities: number[];
  labels: string[];
}) {
  if (probabilities.length === 0) {
    return <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">No data</div>;
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
        height={200}
      />
    );
  }

  return (
    <div className="py-4">
      <PriceBar
        probabilities={probabilities}
        labels={labels}
        variant={market.marketType === MarketType.Binary ? "binary" : "multi"}
      />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/30 bg-muted/20 px-3 py-2">
      <div className="text-lg font-bold tabular-nums leading-tight">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function CountdownUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-center">
      <div className="text-lg font-bold tabular-nums leading-tight">
        {String(value).padStart(2, "0")}
      </div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function SlideshowSkeleton() {
  return (
    <div className="rounded-xl border border-border/40 bg-card/50 p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-10 w-10 animate-pulse rounded-lg bg-muted" />
        <div className="h-6 w-64 animate-pulse rounded bg-muted" />
      </div>
      <div className="flex gap-2 mb-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-14 w-32 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
      <div className="h-48 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

function formatStatValue(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toLocaleString()}`;
}

function deadlineCountdown(deadline: Date): { days: number; hours: number; minutes: number } | null {
  const diff = deadline.getTime() - Date.now();
  if (diff <= 0) return null;
  const totalMinutes = Math.floor(diff / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return { days, hours, minutes };
}
