"use client";

import { Card, CardContent } from "@/components/ui/card";
import { InteractiveDistributionChart } from "./interactive-distribution-chart";
import { type MarketDetail } from "@/lib/types";

interface ContinuousTradingSectionProps {
  market: MarketDetail;
  mu: number | null;
  sigma: number;
  onMuChange: (mu: number | null) => void;
  onSigmaChange: (sigma: number) => void;
  positionHoldings?: number[] | null;
}

export function ContinuousTradingSection({
  market,
  mu,
  sigma,
  onMuChange,
  onSigmaChange,
  positionHoldings,
}: ContinuousTradingSectionProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <InteractiveDistributionChart
          market={market}
          mu={mu}
          sigma={sigma}
          onMuChange={onMuChange}
          onSigmaChange={onSigmaChange}
          positionHoldings={positionHoldings}
        />
      </CardContent>
    </Card>
  );
}
