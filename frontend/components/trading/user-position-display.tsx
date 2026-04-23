"use client";

import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useUserMarketPosition } from "@/hooks/use-user-position";
import { useTokenBalance } from "@/hooks/use-token-balance";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  MarketType,
  MarketState,
  USDC_DECIMALS,
  SCALE,
  computeProbabilities,
  formatUsdc,
  formatProbability,
  type MarketDetail,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const OUTCOME_COLORS = [
  "bg-violet-500",
  "bg-indigo-500",
  "bg-cyan-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-fuchsia-500",
  "bg-sky-500",
];

interface UserPositionDisplayProps {
  market: MarketDetail;
}

export function UserPositionDisplay({ market }: UserPositionDisplayProps) {
  const { publicKey } = useWallet();
  const address = publicKey?.toBase58();

  const { data: position } = useUserMarketPosition(address, market.id);
  const { data: balance = 0 } = useTokenBalance(
    market.collateralMint,
    address,
  );

  if (!address || !position) return null;

  const holdingsNum = position.holdings.map((h) => Number(h));
  const hasHoldings = holdingsNum.some((h) => h > 0);
  if (!hasHoldings) return null;

  const deposited = Number(position.totalDeposited);
  const withdrawn = Number(position.totalWithdrawn);
  const probabilities = useMemo(
    () => computeProbabilities(market.reserves, market.totalMinted, market.kSquared),
    [market.reserves, market.totalMinted, market.kSquared],
  );
  const labels =
    market.outcomeLabels ??
    Array.from({ length: market.numOutcomes }, (_, i) => `Outcome ${i + 1}`);

  const currentValue = computeValue(holdingsNum, probabilities, market);
  const pnl = currentValue - deposited + withdrawn;
  const pnlPct = deposited > 0 ? (pnl / deposited) * 100 : 0;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Your Position
        </h2>
        <span
          className={cn(
            "text-xs font-semibold tabular-nums",
            pnl >= 0 ? "text-emerald-400" : "text-rose-400",
          )}
        >
          {pnl >= 0 ? "+" : ""}
          {formatUsdc(Math.abs(pnl))}
          <span className="ml-1 text-[10px] text-muted-foreground">
            ({pnlPct >= 0 ? "+" : ""}
            {pnlPct.toFixed(1)}%)
          </span>
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Holdings breakdown */}
        <Holdings
          market={market}
          holdings={holdingsNum}
          probabilities={probabilities}
          labels={labels}
        />

        {/* Value / Cost / Balance row */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <MiniStat label="Value" value={formatUsdc(currentValue)} />
          <MiniStat label="Cost" value={formatUsdc(deposited)} />
          <MiniStat label="Balance" value={formatUsdc(balance)} />
        </div>
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/20 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-xs font-medium tabular-nums">{value}</div>
    </div>
  );
}

function computeValue(
  holdings: number[],
  probabilities: number[],
  market: MarketDetail,
): number {
  if (market.state === MarketState.Resolved) {
    if (market.marketType === MarketType.Continuous) {
      if (
        market.resolvedValue != null &&
        market.rangeMin != null &&
        market.rangeMax != null
      ) {
        const resolved = Number(market.resolvedValue) / SCALE;
        const rMin = Number(market.rangeMin) / SCALE;
        const rMax = Number(market.rangeMax) / SCALE;
        const binWidth = (rMax - rMin) / market.numOutcomes;
        const winBin = Math.max(
          0,
          Math.min(
            Math.floor((resolved - rMin) / binWidth),
            market.numOutcomes - 1,
          ),
        );
        return holdings[winBin] ?? 0;
      }
      return 0;
    }
    const winIdx = market.resolvedOutcome;
    if (winIdx != null && winIdx >= 0 && winIdx < holdings.length) {
      return holdings[winIdx];
    }
    return 0;
  }

  let value = 0;
  for (let i = 0; i < holdings.length; i++) {
    value += holdings[i] * (probabilities[i] ?? 0);
  }
  return value;
}

function Holdings({
  market,
  holdings,
  probabilities,
  labels,
}: {
  market: MarketDetail;
  holdings: number[];
  probabilities: number[];
  labels: string[];
}) {
  if (market.marketType === MarketType.Continuous) {
    const maxH = Math.max(...holdings, 1);
    return (
      <div className="flex h-6 items-end gap-px">
        {holdings.map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-sm bg-cyan-500/50"
            style={{
              height: `${Math.max((h / maxH) * 100, h > 0 ? 4 : 0)}%`,
            }}
          />
        ))}
      </div>
    );
  }

  if (market.marketType === MarketType.Binary && holdings.length >= 2) {
    return (
      <div className="space-y-1.5">
        {holdings.map((h, i) =>
          h > 0 ? (
            <div
              key={i}
              className="flex items-center justify-between text-xs"
            >
              <span
                className={cn(
                  "font-medium",
                  i === 0 ? "text-emerald-400" : "text-rose-400",
                )}
              >
                {labels[i]}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {fmtTokens(h)} @ {formatProbability(probabilities[i])}
              </span>
            </div>
          ) : null,
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {holdings.map((h, i) =>
        h > 0 ? (
          <div key={i} className="flex items-center gap-2 text-xs">
            <div
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                OUTCOME_COLORS[i % OUTCOME_COLORS.length],
              )}
            />
            <span className="flex-1 truncate">{labels[i]}</span>
            <span className="tabular-nums text-muted-foreground">
              {fmtTokens(h)}
            </span>
          </div>
        ) : null,
      )}
    </div>
  );
}

function fmtTokens(raw: number): string {
  const n = raw / 10 ** USDC_DECIMALS;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(2);
}
