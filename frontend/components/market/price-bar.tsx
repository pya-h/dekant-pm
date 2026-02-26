import { formatProbability } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Colors for multi-outcome bars (cycle if more outcomes than colors)
const outcomeColors = [
  "bg-violet-500",
  "bg-indigo-500",
  "bg-cyan-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-fuchsia-500",
  "bg-sky-500",
];

interface PriceBarProps {
  probabilities: number[];
  labels: string[];
  variant: "binary" | "multi";
}

export function PriceBar({ probabilities, labels, variant }: PriceBarProps) {
  if (variant === "binary" && probabilities.length >= 2) {
    return (
      <BinaryBar
        yesP={probabilities[0]}
        yesLabel={labels[0] ?? "Yes"}
        noLabel={labels[1] ?? "No"}
      />
    );
  }

  return <MultiBar probabilities={probabilities} labels={labels} />;
}

function BinaryBar({
  yesP,
  yesLabel,
  noLabel,
}: {
  yesP: number;
  yesLabel: string;
  noLabel: string;
}) {
  const noP = 1 - yesP;
  return (
    <div className="space-y-3">
      {/* Large percentage display */}
      <div className="flex items-baseline justify-between">
        <div>
          <span className="text-3xl font-bold text-emerald-400">
            {formatProbability(yesP)}
          </span>
          <span className="ml-2 text-sm text-muted-foreground">{yesLabel}</span>
        </div>
        <div className="text-right">
          <span className="text-3xl font-bold text-muted-foreground">
            {formatProbability(noP)}
          </span>
          <span className="ml-2 text-sm text-muted-foreground">{noLabel}</span>
        </div>
      </div>

      {/* Stacked bar */}
      <div className="flex h-3 w-full overflow-hidden rounded-full">
        <div
          className="bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500"
          style={{ width: `${yesP * 100}%` }}
        />
        <div
          className="bg-muted transition-all duration-500"
          style={{ width: `${noP * 100}%` }}
        />
      </div>
    </div>
  );
}

function MultiBar({
  probabilities,
  labels,
}: {
  probabilities: number[];
  labels: string[];
}) {
  // Sort by probability descending for the list, but keep original order for the bar
  const ranked = probabilities
    .map((p, i) => ({ p, label: labels[i] ?? `Outcome ${i + 1}`, i }))
    .sort((a, b) => b.p - a.p);

  return (
    <div className="space-y-4">
      {/* Stacked horizontal bar */}
      <div className="flex h-3 w-full overflow-hidden rounded-full">
        {probabilities.map((p, i) => (
          <Tooltip key={i}>
            <TooltipTrigger asChild>
              <div
                className={cn(
                  outcomeColors[i % outcomeColors.length],
                  "transition-all duration-500",
                  i === 0 && "rounded-l-full",
                  i === probabilities.length - 1 && "rounded-r-full",
                )}
                style={{ width: `${Math.max(p * 100, 1)}%` }}
              />
            </TooltipTrigger>
            <TooltipContent>
              {labels[i] ?? `Outcome ${i + 1}`}: {formatProbability(p)}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>

      {/* Ranked list */}
      <div className="space-y-2">
        {ranked.map(({ p, label, i }) => (
          <div key={i} className="flex items-center gap-3">
            <div
              className={cn(
                "h-2.5 w-2.5 shrink-0 rounded-full",
                outcomeColors[i % outcomeColors.length],
              )}
            />
            <span className="flex-1 truncate text-sm">{label}</span>
            <span className="text-sm font-medium tabular-nums">
              {formatProbability(p)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
