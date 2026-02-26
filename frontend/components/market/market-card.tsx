import Link from "next/link";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { MarketStatus } from "./market-status";
import { MarketTypeBadge } from "./market-type-badge";
import {
  MarketType,
  SCALE,
  type MarketSummary,
  computeProbabilities,
  formatUsdc,
  formatProbability,
  timeUntil,
} from "@/lib/types";

interface MarketCardProps {
  market: MarketSummary;
}

export function MarketCard({ market }: MarketCardProps) {
  return (
    <Link href={`/markets/${market.id}`} className="group block">
      <Card className="relative h-full overflow-hidden transition-all duration-300 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5">
        {/* Subtle gradient glow on hover */}
        <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-gradient-to-br from-primary/[0.03] to-transparent" />

        <CardHeader className="relative flex flex-row items-start justify-between gap-2 space-y-0 pb-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <MarketTypeBadge type={market.marketType} />
            <MarketStatus state={market.state} />
            {market.category && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                {market.category}
              </span>
            )}
          </div>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {timeUntil(market.deadline)}
          </span>
        </CardHeader>

        <CardContent className="relative space-y-3 pb-3">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug transition-colors group-hover:text-primary">
            {market.title}
          </h3>
          <ProbabilityDisplay market={market} />
        </CardContent>

        <CardFooter className="relative justify-between border-t border-border/40 pt-3 text-xs text-muted-foreground">
          <span className="tabular-nums">Vol {formatUsdc(market.totalVolume)}</span>
          <span className="tabular-nums">
            {market.totalTraders} trader{market.totalTraders !== 1 ? "s" : ""}
          </span>
        </CardFooter>
      </Card>
    </Link>
  );
}

function ProbabilityDisplay({ market }: { market: MarketSummary }) {
  const { marketType, reserves, outcomeLabels } = market;
  const probabilities = computeProbabilities(reserves, market.totalMinted, market.kSquared);

  if (probabilities.length === 0) return null;

  if (marketType === MarketType.Binary && probabilities.length >= 2) {
    const yesLabel = outcomeLabels?.[0] ?? "Yes";
    const noLabel = outcomeLabels?.[1] ?? "No";
    const yesP = probabilities[0];
    return (
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="font-medium text-emerald-400">
            {yesLabel} {formatProbability(yesP)}
          </span>
          <span className="text-muted-foreground">
            {noLabel} {formatProbability(1 - yesP)}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-700 ease-out"
            style={{ width: `${yesP * 100}%` }}
          />
        </div>
      </div>
    );
  }

  if (marketType === MarketType.MultiOutcome && probabilities.length > 0) {
    const topIdx = probabilities.indexOf(Math.max(...probabilities));
    const topLabel = outcomeLabels?.[topIdx] ?? `Outcome ${topIdx + 1}`;
    const topP = probabilities[topIdx];
    return (
      <div className="space-y-1.5">
        <div className="text-xs">
          <span className="font-medium text-foreground">{topLabel}</span>
          <span className="ml-1 text-primary tabular-nums">
            {formatProbability(topP)}
          </span>
        </div>
        <div className="flex gap-0.5">
          {probabilities.map((p, i) => (
            <div
              key={i}
              className="h-1.5 rounded-full bg-primary/60 transition-all duration-700 ease-out"
              style={{ width: `${Math.max(p * 100, 2)}%` }}
              title={`${outcomeLabels?.[i] ?? `#${i + 1}`}: ${formatProbability(p)}`}
            />
          ))}
        </div>
      </div>
    );
  }

  // Continuous
  if (marketType === MarketType.Continuous && probabilities.length > 0) {
    const maxP = Math.max(...probabilities);
    if (maxP === 0) return null;
    const peakIdx = probabilities.indexOf(maxP);
    const rMin = market.rangeMin != null ? Number(market.rangeMin) / SCALE : null;
    const rMax = market.rangeMax != null ? Number(market.rangeMax) / SCALE : null;
    const binWidth =
      rMin != null && rMax != null ? (rMax - rMin) / market.numOutcomes : null;
    const peakValue =
      binWidth != null && rMin != null
        ? rMin + binWidth * (peakIdx + 0.5)
        : null;
    return (
      <div className="space-y-1.5">
        {peakValue != null && (
          <div className="text-xs text-muted-foreground">
            Peak:{" "}
            <span className="font-medium tabular-nums text-foreground">
              {peakValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          </div>
        )}
        <div className="flex h-8 items-end gap-px">
          {probabilities.map((p, i) => (
            <div
              key={i}
              className="flex-1 rounded-t-sm bg-cyan-500/60 transition-all duration-700 ease-out"
              style={{ height: `${Math.max((p / maxP) * 100, 4)}%` }}
            />
          ))}
        </div>
      </div>
    );
  }

  return null;
}
