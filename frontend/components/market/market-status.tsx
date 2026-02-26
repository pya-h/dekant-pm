import { Badge } from "@/components/ui/badge";
import { MarketState } from "@/lib/types";
import { cn } from "@/lib/utils";

const stateConfig: Record<
  MarketState,
  { label: string; className: string }
> = {
  [MarketState.Active]: {
    label: "Active",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  },
  [MarketState.Paused]: {
    label: "Paused",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  },
  [MarketState.PendingResolution]: {
    label: "Pending",
    className: "border-orange-500/30 bg-orange-500/10 text-orange-400",
  },
  [MarketState.Resolved]: {
    label: "Resolved",
    className: "border-sky-500/30 bg-sky-500/10 text-sky-400",
  },
};

interface MarketStatusProps {
  state: MarketState;
  className?: string;
}

export function MarketStatus({ state, className }: MarketStatusProps) {
  const config = stateConfig[state];
  return (
    <Badge
      variant="outline"
      className={cn("text-[11px] font-medium", config.className, className)}
    >
      {config.label}
    </Badge>
  );
}
