"use client";

import { useState, useCallback } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BinaryInput } from "./binary-input";
import { MultiOutcomeInput } from "./multi-outcome-input";
import { DistributionInput } from "./distribution-input";
import { CostPreview } from "./cost-preview";
import { MarketType, MarketState, type MarketDetail } from "@/lib/types";

type TradeParams =
  | { outcome: number; amount: string }
  | { mu: number; sigma: number; amount: string };

interface TradingPanelProps {
  market: MarketDetail;
}

export function TradingPanel({ market }: TradingPanelProps) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [params, setParams] = useState<TradeParams | null>(null);

  const handleParamsChange = useCallback(
    (p: TradeParams | null) => setParams(p),
    [],
  );

  const isDisabled = market.state !== MarketState.Active;
  const isContinuous = market.marketType === MarketType.Continuous;
  const hasValidParams = params !== null && Number(params.amount) > 0;

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Trade
        </h2>
        {!isDisabled && (
          <Tabs
            value={side}
            onValueChange={(v) => {
              setSide(v as "buy" | "sell");
              setParams(null);
            }}
          >
            <TabsList className="w-full">
              <TabsTrigger value="buy" className="flex-1">
                Buy
              </TabsTrigger>
              <TabsTrigger value="sell" className="flex-1">
                Sell
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {isDisabled ? (
          <DisabledMessage state={market.state} />
        ) : isContinuous ? (
          side === "sell" ? (
            <SellUnavailable />
          ) : (
            <>
              <DistributionInput
                market={market}
                onParamsChange={handleParamsChange}
              />

              {hasValidParams && params && "mu" in params && (
                <CostPreview
                  marketId={market.id}
                  side="buy"
                  mu={params.mu}
                  sigma={params.sigma}
                  amount={params.amount}
                />
              )}

              <Button className="w-full" disabled={!hasValidParams}>
                Place Buy Order
              </Button>
            </>
          )
        ) : (
          <>
            {market.marketType === MarketType.Binary ? (
              <BinaryInput
                market={market}
                side={side}
                onParamsChange={handleParamsChange}
              />
            ) : (
              <MultiOutcomeInput
                market={market}
                side={side}
                onParamsChange={handleParamsChange}
              />
            )}

            {hasValidParams && params && "outcome" in params && (
              <CostPreview
                marketId={market.id}
                side={side}
                outcome={params.outcome}
                amount={params.amount}
              />
            )}

            <Button
              className="w-full"
              disabled={!hasValidParams}
            >
              {side === "buy" ? "Place Buy Order" : "Place Sell Order"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DisabledMessage({ state }: { state: MarketState }) {
  const message =
    state === MarketState.Resolved
      ? "This market has been resolved"
      : state === MarketState.Paused
        ? "Trading is paused"
        : "This market is pending resolution";

  return (
    <div className="rounded-lg border border-dashed border-border/60 p-6 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function SellUnavailable() {
  return (
    <div className="flex h-24 flex-col items-center justify-center rounded-lg border border-dashed border-border/60 text-center">
      <p className="text-sm text-muted-foreground">
        Distribution selling coming soon
      </p>
      <p className="mt-1 text-xs text-muted-foreground/60">
        Sell estimation for continuous markets is not yet available
      </p>
    </div>
  );
}
