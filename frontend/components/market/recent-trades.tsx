"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { USDC_DECIMALS, SCALE } from "@/lib/types";
import { cn } from "@/lib/utils";

const RECENT_TRADES_COUNT = 10;

interface Trade {
  id: string;
  marketId: string;
  trader: string;
  isBuy: boolean;
  collateralAmount: string;
  outcomeIndex: number | null;
  mu: string | null;
  sigma: string | null;
  tokensTransacted: string;
  feePaid: string;
  txSignature: string;
  slot: string;
  timestamp: string;
}

interface RecentTradesProps {
  marketId: string;
  rangeMin?: number;
  rangeMax?: number;
}

export function RecentTrades({ marketId, rangeMin, rangeMax }: RecentTradesProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["recentTrades", marketId],
    queryFn: () =>
      api.get<{ data: Trade[]; total: number }>(
        `/markets/${marketId}/history`,
        { limit: RECENT_TRADES_COUNT },
      ),
    staleTime: 15_000,
    refetchInterval: 15_000,
  });

  const trades = useMemo(() => data?.data ?? [], [data]);

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <h2 className="text-sm font-semibold">Recent Trades</h2>
      </CardHeader>
      <CardContent className="px-3 pb-3">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-5 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : trades.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No trades yet
          </p>
        ) : (
          <TradeList trades={trades} rangeMin={rangeMin} rangeMax={rangeMax} />
        )}
      </CardContent>
    </Card>
  );
}

function TradeList({
  trades,
  rangeMin,
  rangeMax,
}: {
  trades: Trade[];
  rangeMin?: number;
  rangeMax?: number;
}) {
  // Header row
  return (
    <div>
      <div className="mb-1.5 flex items-center text-[10px] uppercase tracking-wide text-muted-foreground">
        <span className="w-[52px]">Direction</span>
        <span className="flex-1 text-right">Amount</span>
        <span className="w-[52px] text-right">Time</span>
      </div>
      <div className="space-y-0">
        {trades.map((trade, i) => {
          const separator = getDaySeparator(trade, trades[i - 1]);
          return (
            <div key={trade.id}>
              {separator && (
                <div className="my-1.5 flex items-center gap-2">
                  <div className="h-px flex-1 bg-border/30" />
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60">
                    {separator}
                  </span>
                  <div className="h-px flex-1 bg-border/30" />
                </div>
              )}
              <TradeRow trade={trade} rangeMin={rangeMin} rangeMax={rangeMax} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TradeRow({
  trade,
  rangeMin,
  rangeMax,
}: {
  trade: Trade;
  rangeMin?: number;
  rangeMax?: number;
}) {
  // Direction: for continuous markets use mu (peak); for discrete, use outcome index
  let directionLabel: string;
  if (trade.mu != null) {
    const muVal = Number(trade.mu) / SCALE;
    // Format compactly
    if (Math.abs(muVal) >= 1_000) {
      directionLabel = `${(muVal / 1_000).toFixed(1)}K`;
    } else {
      directionLabel = muVal.toLocaleString(undefined, {
        maximumFractionDigits: 1,
      });
    }
  } else if (trade.outcomeIndex != null) {
    directionLabel = `#${trade.outcomeIndex}`;
  } else {
    directionLabel = "—";
  }

  // Amount: collateral paid (buy) or received (sell)
  const amount = formatCompactUsdc(Number(trade.collateralAmount));

  // Time
  const date = new Date(trade.timestamp);
  const timeStr = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return (
    <div className="flex items-center py-[3px] text-xs tabular-nums">
      <span
        className={cn(
          "w-[52px] font-medium",
          trade.isBuy ? "text-emerald-400" : "text-rose-400",
        )}
      >
        {directionLabel}
      </span>
      <span
        className={cn(
          "flex-1 text-right",
          trade.isBuy ? "text-emerald-400/80" : "text-rose-400/80",
        )}
      >
        {amount}
      </span>
      <span className="w-[52px] text-right text-muted-foreground">
        {timeStr}
      </span>
    </div>
  );
}

/** Returns a day separator label if this trade is on a different day than the previous one */
function getDaySeparator(
  current: Trade,
  previous: Trade | undefined,
): string | null {
  if (!previous) return null;

  const curDate = new Date(current.timestamp);
  const prevDate = new Date(previous.timestamp);

  const curDay = toDateKey(curDate);
  const prevDay = toDateKey(prevDate);

  if (curDay === prevDay) return null;

  const today = toDateKey(new Date());
  const yesterday = toDateKey(
    new Date(Date.now() - 86_400_000),
  );

  if (curDay === yesterday) return "Yesterday";
  if (curDay === today) return "Today";

  // Older dates: "Jan 3" format
  return curDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatCompactUsdc(raw: number): string {
  const n = Math.abs(raw) / 10 ** USDC_DECIMALS;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}
