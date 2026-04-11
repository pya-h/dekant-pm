import { Badge } from "@/components/ui/badge";
import { MarketState } from "@/lib/types";
import { cn } from "@/lib/utils";

const stateConfig: Record<
  MarketState,
  { label: string; className: string; dot?: string }
> = {
  [MarketState.Active]: {
    label: "Active",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    dot: "bg-emerald-500",
  },
  [MarketState.Paused]: {
    label: "Paused",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    dot: "bg-amber-500",
  },
  [MarketState.PendingResolution]: {
    label: "Pending",
    className: "border-orange-500/30 bg-orange-500/10 text-orange-400",
    dot: "bg-orange-500",
  },
  [MarketState.Resolved]: {
    label: "Resolved",
    className: "border-sky-500/30 bg-sky-500/10 text-sky-400",
    dot: "bg-sky-500",
  },
};

interface MarketStatusProps {
  state: MarketState;
  className?: string;
}

const fallback = { label: "Unknown", className: "border-zinc-500/30 bg-zinc-500/10 text-zinc-400" };

export function MarketStatus({ state, className }: MarketStatusProps) {
  const config = stateConfig[state] ?? fallback;
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 text-[11px] font-medium", config.className, className)}
    >
      {config.dot && (
        <span className="relative flex h-1.5 w-1.5">
          {state === MarketState.Active && (
            <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-75", config.dot)} />
          )}
          <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", config.dot)} />
        </span>
      )}
      {config.label}
    </Badge>
  );
}
