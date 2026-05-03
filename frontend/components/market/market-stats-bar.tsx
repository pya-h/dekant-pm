"use client";

import { useOracleData } from "@/hooks/use-oracle-data";
import { MarketType, formatUsdc, type MarketSummary } from "@/lib/types";

interface MarketStatsBarProps {
  market: Pick<MarketSummary, "id" | "marketType" | "reserves" | "totalVolume">;
}

export function MarketStatsBar({ market }: MarketStatsBarProps) {
  const isContinuous = market.marketType === MarketType.Continuous;
  const { data: oracleData } = useOracleData(market.id, isContinuous);
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
      <StatCard label="Volume" value={formatUsdc(market.totalVolume)} />
    </>
  );
}

export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/30 bg-muted/20 px-3 py-2">
      <div className="text-lg font-bold tabular-nums leading-tight">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function formatStatValue(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toLocaleString()}`;
}
