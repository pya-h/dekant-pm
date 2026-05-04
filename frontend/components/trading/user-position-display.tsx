"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { useUserMarketPosition } from "@/hooks/use-user-position";
import { useTokenBalance } from "@/hooks/use-token-balance";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { History, Loader2, ArrowUpRight, ArrowDownRight } from "lucide-react";

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
  const [historyOpen, setHistoryOpen] = useState(false);

  const { data: position } = useUserMarketPosition(address, market.id);
  const { data: balance = 0 } = useTokenBalance(
    market.collateralMint,
    address,
  );
  const probabilities = useMemo(
    () => computeProbabilities(market.reserves, market.totalMinted, market.kSquared),
    [market.reserves, market.totalMinted, market.kSquared],
  );

  if (!address || !position) return null;

  const holdingsNum = position.holdings.map((h) => Number(h));
  const hasHoldings = holdingsNum.some((h) => h > 0);
  if (!hasHoldings) return null;

  const deposited = Number(position.totalDeposited);
  const withdrawn = Number(position.totalWithdrawn);
  const netInvested = deposited - withdrawn;
  const labels =
    market.outcomeLabels ??
    Array.from({ length: market.numOutcomes }, (_, i) => `Outcome ${i + 1}`);

  const currentValue = computeValue(holdingsNum, probabilities, market);
  const pnl = currentValue - netInvested;
  const pnlPct = netInvested > 0 ? (pnl / netInvested) * 100 : 0;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Your Position
        </h2>
        <div className="flex items-center gap-2">
          {market.state === MarketState.Resolved && (
            <Badge
              variant="outline"
              className={cn(
                "text-[10px]",
                position.claimed
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-400",
              )}
            >
              {position.claimed ? "Claimed" : "Unclaimed"}
            </Badge>
          )}
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
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Holdings breakdown */}
        <Holdings
          market={market}
          holdings={holdingsNum}
          probabilities={probabilities}
          labels={labels}
        />

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
          <MiniStat label="Value" value={formatUsdc(currentValue)} />
          <MiniStat label="Invested" value={formatUsdc(deposited)} />
          <MiniStat label="Withdrawn" value={formatUsdc(withdrawn)} />
          <MiniStat label="Balance" value={formatUsdc(balance)} />
        </div>

        {/* Trade History button */}
        <Button
          variant="ghost"
          size="sm"
          className="w-full gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setHistoryOpen(true)}
        >
          <History className="h-3.5 w-3.5" />
          Trade History
        </Button>

        {/* Trade History modal */}
        <TradeHistoryDialog
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          marketId={market.id}
          marketTitle={market.title}
          marketType={market.marketType}
          labels={labels}
          userAddress={address}
        />
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
            className="flex-1 rounded-t-sm"
            style={{
              backgroundColor: "rgba(190, 175, 55, 0.5)",
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

function TradeHistoryDialog({
  open,
  onOpenChange,
  marketId,
  marketTitle,
  marketType,
  labels,
  userAddress,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  marketId: string;
  marketTitle: string;
  marketType: MarketType;
  labels: string[];
  userAddress: string;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["marketTradeHistory", marketId],
    queryFn: () =>
      api.get<{ data: Trade[]; total: number }>(
        `/markets/${marketId}/history`,
        { limit: 100 },
      ),
    staleTime: 30_000,
    enabled: open,
  });

  const userTrades = useMemo(
    () => data?.data.filter((t) => t.trader === userAddress) ?? [],
    [data, userAddress],
  );

  const totalFees = useMemo(
    () => userTrades.reduce((sum, t) => sum + Number(t.feePaid), 0),
    [userTrades],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Trade History</DialogTitle>
          <p className="truncate text-xs text-muted-foreground">
            {marketTitle}
          </p>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : userTrades.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No trades found
          </div>
        ) : (
          <>
            {/* Summary row */}
            <div className="flex items-center justify-between rounded-md bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              <span>{userTrades.length} trade{userTrades.length !== 1 ? "s" : ""}</span>
              <span>Total fees: {formatUsdc(totalFees)}</span>
            </div>

            {/* Trade list */}
            <div className="max-h-[50vh] divide-y divide-border/30 overflow-y-auto">
              {userTrades.map((trade) => (
                <TradeRow
                  key={trade.id}
                  trade={trade}
                  marketType={marketType}
                  labels={labels}
                />
              ))}
            </div>
          </>
        )}

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}

function TradeRow({
  trade,
  marketType,
  labels,
}: {
  trade: Trade;
  marketType: MarketType;
  labels: string[];
}) {
  const amount = formatUsdc(trade.collateralAmount);
  const tokens = fmtTokens(Number(trade.tokensTransacted));
  const fee = formatUsdc(trade.feePaid);
  const date = new Date(trade.timestamp);
  const timeStr = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  let outcomeLabel: string | null = null;
  if (marketType === MarketType.Continuous) {
    if (trade.mu != null) {
      const mu = Number(trade.mu) / SCALE;
      outcomeLabel = `μ=${mu.toFixed(2)}`;
    }
  } else if (trade.outcomeIndex != null) {
    outcomeLabel = labels[trade.outcomeIndex] ?? `#${trade.outcomeIndex}`;
  }

  return (
    <div className="flex items-start gap-2.5 px-1 py-2.5">
      <div
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
          trade.isBuy
            ? "bg-emerald-500/15 text-emerald-400"
            : "bg-rose-500/15 text-rose-400",
        )}
      >
        {trade.isBuy ? (
          <ArrowUpRight className="h-3 w-3" />
        ) : (
          <ArrowDownRight className="h-3 w-3" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "text-xs font-medium",
              trade.isBuy ? "text-emerald-400" : "text-rose-400",
            )}
          >
            {trade.isBuy ? "Buy" : "Sell"}
          </span>
          {outcomeLabel && (
            <span className="truncate text-xs text-muted-foreground">
              {outcomeLabel}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          <span>{amount}</span>
          <span>{tokens} tokens</span>
          <span>fee {fee}</span>
        </div>
      </div>
      <span className="shrink-0 text-[10px] text-muted-foreground">
        {timeStr}
      </span>
    </div>
  );
}
