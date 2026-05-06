"use client";

import { useMemo } from "react";
import { useOracleData } from "@/hooks/use-oracle-data";
import {
  MarketType,
  SCALE,
  formatUsdc,
  type MarketSummary,
} from "@/lib/types";

interface MarketStatsBarProps {
  market: Pick<
    MarketSummary,
    "id" | "marketType" | "reserves" | "totalVolume" | "rangeMin" | "rangeMax" | "subject"
  >;
}

export function MarketStatsBar({ market }: MarketStatsBarProps) {
  const isContinuous = market.marketType === MarketType.Continuous;
  const { data: oracleData } = useOracleData(market.id, isContinuous);
  const liquidity = market.reserves.reduce((sum, r) => sum + Number(r), 0);

  // Placeholder live price: random-ish but stable value within the market range
  const livePrice = useMemo(() => {
    if (!isContinuous || market.rangeMin == null || market.rangeMax == null)
      return null;
    const rMin = Number(market.rangeMin) / SCALE;
    const rMax = Number(market.rangeMax) / SCALE;
    // Use distribution peak if available, otherwise midpoint with small offset
    if (oracleData?.distributionPeak != null) {
      // Simulate a live price near the distribution peak
      const offset = (rMax - rMin) * 0.03;
      return oracleData.distributionPeak - offset;
    }
    return rMin + (rMax - rMin) * 0.48;
  }, [isContinuous, market.rangeMin, market.rangeMax, oracleData?.distributionPeak]);

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
      {livePrice != null && (
        <StatCard
          label={`${market.subject} Price (live)*`}
          value={formatStatValue(livePrice)}
        />
      )}
    </>
  );
}

export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/30 bg-muted/20 px-4 py-2.5 min-w-0">
      <div className="text-base font-bold tabular-nums leading-tight whitespace-nowrap">{value}</div>
      <div className="text-[11px] text-muted-foreground whitespace-nowrap">{label}</div>
    </div>
  );
}

function formatStatValue(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toLocaleString()}`;
}
