import { Badge } from "@/components/ui/badge";
import { MarketType } from "@/lib/types";
import { cn } from "@/lib/utils";

const typeConfig: Record<MarketType, { label: string; className: string }> = {
  [MarketType.Binary]: {
    label: "Binary",
    className: "border-violet-500/30 bg-violet-500/10 text-violet-400",
  },
  [MarketType.MultiOutcome]: {
    label: "Multi",
    className: "border-indigo-500/30 bg-indigo-500/10 text-indigo-400",
  },
  [MarketType.Continuous]: {
    label: "Continuous",
    className: "border-cyan-500/30 bg-cyan-500/10 text-cyan-400",
  },
};

interface MarketTypeBadgeProps {
  type: MarketType;
  className?: string;
}

export function MarketTypeBadge({ type, className }: MarketTypeBadgeProps) {
  const config = typeConfig[type];
  return (
    <Badge
      variant="outline"
      className={cn("text-[11px] font-medium", config.className, className)}
    >
      {config.label}
    </Badge>
  );
}
