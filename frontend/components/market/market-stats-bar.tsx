"use client";

import { useOracleData } from "@/hooks/use-oracle-data";
import { useLivePrice } from "@/hooks/use-live-price";
import {
  MarketType,
  formatUsdc,
  type MarketSummary,
} from "@/lib/types";

interface MarketStatsBarProps {
  market: Pick<
    MarketSummary,
    "id" | "marketType" | "reserves" | "totalVolume" | "rangeMin" | "rangeMax" | "subject" | "category"
  >;
}

export function MarketStatsBar({ market }: MarketStatsBarProps) {
  const isContinuous = market.marketType === MarketType.Continuous;
  const { data: oracleData } = useOracleData(market.id, isContinuous);
  const { data: priceData } = useLivePrice(market.id, market.category);
  const liquidity = market.reserves.reduce((sum, r) => sum + Number(r), 0);

  return (
    <>
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
      <StatCard label="Volume (24h)" value={formatUsdc(market.totalVolume)} />
      {priceData?.price != null && (
        <StatCard
          label={`${market.subject} Price`}
          value={formatStatValue(priceData.price.price)}
          stale={priceData.price.stale}
        />
      )}
    </>
  );
}

export function StatCard({ label, value, stale }: { label: string; value: string; stale?: boolean }) {
  return (
    <div className="rounded-lg border border-border/30 bg-muted/20 px-4 py-2.5 min-w-0">
      <div className="text-base font-bold tabular-nums leading-tight whitespace-nowrap">{value}</div>
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground whitespace-nowrap">
        {label}
        {stale && (
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" title="Price may be stale" />
        )}
      </div>
    </div>
  );
}

function formatStatValue(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toLocaleString()}`;
}
