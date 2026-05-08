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
  /** When true, chart is non-interactive (sell side: shows position only) */
  readOnly?: boolean;
}

export function ContinuousTradingSection({
  market,
  mu,
  sigma,
  onMuChange,
  onSigmaChange,
  positionHoldings,
  readOnly,
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
          readOnly={readOnly}
        />
      </CardContent>
    </Card>
  );
}
