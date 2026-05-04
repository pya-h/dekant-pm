"use client";

import { Card, CardContent } from "@/components/ui/card";
import { InteractiveDistributionChart } from "./interactive-distribution-chart";
import { MarketStatsBar } from "@/components/market/market-stats-bar";
import { type MarketDetail } from "@/lib/types";

interface ContinuousTradingSectionProps {
  market: MarketDetail;
  mu: number | null;
  sigma: number;
  onMuChange: (mu: number | null) => void;
  onSigmaChange: (sigma: number) => void;
}

export function ContinuousTradingSection({
  market,
  mu,
  sigma,
  onMuChange,
  onSigmaChange,
}: ContinuousTradingSectionProps) {
  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        {/* Stats bar */}
        <div className="flex flex-wrap items-stretch gap-2">
          <MarketStatsBar market={market} />
        </div>

        {/* Interactive chart */}
        <InteractiveDistributionChart
          market={market}
          mu={mu}
          sigma={sigma}
          onMuChange={onMuChange}
          onSigmaChange={onSigmaChange}
        />
      </CardContent>
    </Card>
  );
}
