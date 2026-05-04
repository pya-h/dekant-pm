"use client";

import { useMemo } from "react";
import { useMarkets } from "@/hooks/use-markets";
import { MarketCard } from "@/components/market/market-card";
import type { MarketDetail } from "@/lib/types";

interface RelatedMarketsRowProps {
  market: MarketDetail;
}

const ROW_COUNT = 5;

export function RelatedMarketsRow({ market }: RelatedMarketsRowProps) {
  const subject = market.subject?.trim();

  const { data, isLoading, isError } = useMarkets({
    page: 1,
    limit: 12,
    sortBy: "newest",
    enabled: !!subject,
    ...(subject && { subject }),
  });

  const relatedMarkets = useMemo(() => {
    const all = data?.data ?? [];
    return all.filter((m) => m.id !== market.id).slice(0, ROW_COUNT);
  }, [data, market.id]);

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between">
        <h3 className="text-xl font-bold tracking-tight">Markets</h3>
        {subject && (
          <span className="text-xs text-muted-foreground">
            Same asset: {subject}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: ROW_COUNT }).map((_, i) => (
            <div
              key={i}
              className="h-44 animate-pulse rounded-xl border bg-card/50"
            />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-border/30 bg-muted/20 p-4 text-sm text-muted-foreground">
          Related markets are temporarily unavailable.
        </div>
      ) : relatedMarkets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/40 p-6 text-center text-sm text-muted-foreground">
          No other markets found for this asset yet.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          {relatedMarkets.map((related) => (
            <MarketCard key={related.id} market={related} />
          ))}
        </div>
      )}
    </section>
  );
}
