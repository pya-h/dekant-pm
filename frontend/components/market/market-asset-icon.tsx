"use client";

import { cn } from "@/lib/utils";
import { getMarketAssetVisual } from "@/lib/market-asset";

interface MarketAssetIconProps {
  subject: string | null;
  icon: string | null;
  className?: string;
  symbolClassName?: string;
  imageClassName?: string;
}

export function MarketAssetIcon({
  subject,
  icon,
  className,
  symbolClassName,
  imageClassName,
}: MarketAssetIconProps) {
  const visual = getMarketAssetVisual(subject, icon);

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-lg",
        visual.bgClass,
        className,
      )}
      title={visual.asset || "Unknown asset"}
      aria-label={visual.asset || "Unknown asset"}
    >
      {visual.imageSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={visual.imageSrc}
          alt={visual.asset || "Market icon"}
          className={cn("h-4 w-4 rounded-full object-cover", imageClassName)}
          loading="lazy"
        />
      ) : (
        <span
          className={cn(
            "text-sm font-semibold leading-none",
            visual.textClass,
            symbolClassName,
          )}
        >
          {visual.symbol}
        </span>
      )}
    </div>
  );
}
