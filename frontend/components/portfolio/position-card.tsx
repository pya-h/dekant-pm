"use client";

import Link from "next/link";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { MarketStatus } from "@/components/market/market-status";
import { MarketTypeBadge } from "@/components/market/market-type-badge";
import { ClaimButton } from "./claim-button";
import {
  MarketType,
  MarketState,
  USDC_DECIMALS,
  SCALE,
  computeProbabilities,
  formatUsdc,
  formatProbability,
  timeUntil,
  type UserPosition,
} from "@/lib/types";
import { computeAmmSellProceeds } from "@/lib/portfolio-utils";
import { cn } from "@/lib/utils";

interface PositionCardProps {
  position: UserPosition;
  variant?: "grid" | "modal";
}

export function PositionCard({ position, variant = "grid" }: PositionCardProps) {
  const isModal = variant === "modal";
  const { market } = position;
  const probabilities = computeProbabilities(
    market.reserves,
    market.totalMinted,
  );
  const labels =
    market.outcomeLabels ??
    Array.from({ length: market.numOutcomes }, (_, i) => `Outcome ${i + 1}`);

  const holdingsNum = position.holdings.map((h) => Number(h));
  const hasHoldings = holdingsNum.some((h) => h > 0);
  const deposited = Number(position.totalDeposited);
  const withdrawn = Number(position.totalWithdrawn);

  // Liquidation value (what you'd get selling now, after fees)
  const currentValue = computeCurrentValue(holdingsNum, market);
  const paidPrice = deposited - withdrawn;
  const pnl = currentValue - paidPrice;
  const pnlPct = paidPrice > 0 ? (pnl / paidPrice) * 100 : 0;

  const isClaimable =
    market.state === MarketState.Resolved && !position.claimed && hasHoldings;

  const resolutionLabel =
    market.state === MarketState.Resolved
      ? getResolutionLabel(market, labels)
      : null;

  return (
    <Card
      className={cn(
        "relative overflow-hidden",
        isModal
          ? "border-0 bg-transparent py-0 shadow-none"
          : "h-full transition-all duration-300 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5",
      )}
    >
      {/* Hover glow (grid variant only) */}
      {!isModal && (
        <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-gradient-to-br from-primary/[0.03] to-transparent" />
      )}

      <CardHeader
        className={cn("relative space-y-3 pb-3", isModal && "px-0")}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <MarketTypeBadge type={market.marketType} />
            <MarketStatus state={market.state} />
          </div>
          {hasHoldings && (
            <span
              className={cn(
                "text-xs font-semibold tabular-nums",
                pnl >= 0 ? "text-emerald-400" : "text-rose-400",
              )}
            >
              {pnl >= 0 ? "+" : "-"}
              {formatUsdc(Math.abs(pnl))}
              <span className="ml-1 text-[10px] text-muted-foreground">
                ({pnlPct >= 0 ? "+" : ""}
                {pnlPct.toFixed(1)}%)
              </span>
            </span>
          )}
        </div>

        <Link
          href={`/markets/${market.id}`}
          className="line-clamp-2 text-sm font-semibold leading-snug transition-colors hover:text-primary"
        >
          {market.title}
        </Link>
      </CardHeader>

      <CardContent
        className={cn("relative space-y-3 pb-3", isModal && "px-0")}
      >
        {resolutionLabel !== null && (
          <div className="flex items-center justify-between rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-xs">
            <span className="text-muted-foreground">Resolved</span>
            <span className="font-medium text-foreground">
              {resolutionLabel}
            </span>
          </div>
        )}

        <HoldingsDisplay
          market={market}
          holdings={holdingsNum}
          probabilities={probabilities}
          labels={labels}
        />

        {isClaimable && (
          <ClaimButton
            marketPubkey={market.pubkey}
            marketId={market.id}
            collateralMint={market.collateralMint}
            estimatedPayout={currentValue}
          />
        )}
      </CardContent>

      <CardFooter
        className={cn(
          "relative justify-between border-t border-border/40 pt-3 text-xs text-muted-foreground",
          isModal && "px-0",
        )}
      >
        <span className="tabular-nums">
          Value {formatUsdc(currentValue)}
        </span>
        <span className="tabular-nums">
          Cost {formatUsdc(deposited)}
        </span>
        {market.state === MarketState.Active && (
          <span className="tabular-nums">{timeUntil(market.deadline)}</span>
        )}
      </CardFooter>
    </Card>
  );
}

function getResolutionLabel(
  market: UserPosition["market"],
  labels: string[],
): string {
  if (market.marketType === MarketType.Continuous) {
    if (market.resolvedValue != null) {
      return String(Number(market.resolvedValue) / SCALE);
    }
    return "—";
  }
  const winIdx = market.resolvedOutcome;
  if (winIdx != null && winIdx >= 0 && winIdx < labels.length) {
    return labels[winIdx];
  }
  return "—";
}

function computeCurrentValue(
  holdings: number[],
  market: UserPosition["market"],
): number {
  // For resolved markets: winning tokens are worth face value
  if (market.state === MarketState.Resolved) {
    if (market.marketType === MarketType.Continuous) {
      if (market.resolvedValue != null && market.rangeMin != null && market.rangeMax != null) {
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

  // Active/Paused markets: AMM sell proceeds after fees
  return computeAmmSellProceeds(market.reserves, market.totalMinted, holdings);
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

function HoldingsDisplay({
  market,
  holdings,
  probabilities,
  labels,
}: {
  market: UserPosition["market"];
  holdings: number[];
  probabilities: number[];
  labels: string[];
}) {
  const nonZero = holdings.filter((h) => h > 0);
  if (nonZero.length === 0) {
    return (
      <p className="text-xs text-muted-foreground/60">No active holdings</p>
    );
  }

  // Continuous: mini histogram
  if (market.marketType === MarketType.Continuous) {
    return <ContinuousHoldings holdings={holdings} />;
  }

  // Binary
  if (market.marketType === MarketType.Binary && holdings.length >= 2) {
    return (
      <div className="space-y-2">
        {holdings.map((h, i) =>
          h > 0 ? (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className={cn("font-medium", i === 0 ? "text-emerald-400" : "text-rose-400")}>
                {labels[i]}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {formatTokenAmount(h)} @ {formatProbability(probabilities[i])}
              </span>
            </div>
          ) : null,
        )}
      </div>
    );
  }

  // Multi-outcome: list holdings
  return (
    <div className="space-y-1.5">
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
              {formatTokenAmount(h)}
            </span>
          </div>
        ) : null,
      )}
    </div>
  );
}

function ContinuousHoldings({ holdings }: { holdings: number[] }) {
  const maxH = Math.max(...holdings, 1);
  return (
    <div className="flex h-8 items-end gap-px">
      {holdings.map((h, i) => (
        <div
          key={i}
          className="flex-1 rounded-t-sm transition-all duration-500 ease-out"
          style={{
            backgroundColor: "rgba(190, 175, 55, 0.5)",
            height: `${Math.max((h / maxH) * 100, h > 0 ? 4 : 0)}%`,
          }}
        />
      ))}
    </div>
  );
}

function formatTokenAmount(raw: number): string {
  const n = raw / 10 ** USDC_DECIMALS;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(2);
}
