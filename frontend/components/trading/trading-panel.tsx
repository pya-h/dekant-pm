"use client";

import { useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useQueryClient } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { Loader2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BinaryInput } from "./binary-input";
import { MultiOutcomeInput } from "./multi-outcome-input";
import { DistributionInput } from "./distribution-input";
import { CostPreview } from "./cost-preview";
import { MarketType, MarketState, type MarketDetail } from "@/lib/types";
import { useProgram } from "@/lib/solana";
import {
  executeBuy,
  executeSell,
  executeBuyDistribution,
} from "@/lib/transactions";
import {
  showTradeSuccess,
  showTradeError,
} from "@/components/common/transaction-toast";

type TradeParams =
  | { outcome: number; amount: string }
  | { mu: number; sigma: number; amount: string };

interface TradingPanelProps {
  market: MarketDetail;
}

export function TradingPanel({ market }: TradingPanelProps) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [params, setParams] = useState<TradeParams | null>(null);
  const [loading, setLoading] = useState(false);

  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const program = useProgram();
  const queryClient = useQueryClient();

  const handleParamsChange = useCallback(
    (p: TradeParams | null) => setParams(p),
    [],
  );

  const isDisabled = market.state !== MarketState.Active;
  const isContinuous = market.marketType === MarketType.Continuous;
  const hasValidParams = params !== null && Number(params.amount) > 0;

  const handleSubmit = useCallback(async () => {
    if (!connected || !publicKey || !program) {
      setVisible(true);
      return;
    }
    if (!params) return;

    setLoading(true);
    try {
      const marketPubkey = new PublicKey(market.pubkey);
      let signature: string;

      if (side === "buy") {
        if (isContinuous && "mu" in params) {
          signature = await executeBuyDistribution(
            program,
            marketPubkey,
            publicKey,
            params.mu,
            params.sigma,
            params.amount,
          );
        } else if ("outcome" in params) {
          signature = await executeBuy(
            program,
            marketPubkey,
            publicKey,
            params.outcome,
            params.amount,
          );
        } else {
          return;
        }
      } else {
        if ("outcome" in params) {
          signature = await executeSell(
            program,
            marketPubkey,
            publicKey,
            params.outcome,
            params.amount,
          );
        } else {
          return;
        }
      }

      showTradeSuccess(signature, side === "buy" ? "Buy" : "Sell");
      queryClient.invalidateQueries({ queryKey: ["market", market.id] });
      setParams(null);
    } catch (error) {
      showTradeError(error);
    } finally {
      setLoading(false);
    }
  }, [
    connected,
    publicKey,
    program,
    params,
    side,
    market.pubkey,
    market.id,
    isContinuous,
    setVisible,
    queryClient,
  ]);

  const buttonLabel = !connected
    ? "Connect Wallet"
    : loading
      ? "Confirming..."
      : side === "buy"
        ? "Place Buy Order"
        : "Place Sell Order";

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

              <Button
                className="w-full"
                disabled={(!hasValidParams && connected) || loading}
                onClick={handleSubmit}
              >
                {loading && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {buttonLabel}
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
              disabled={(!hasValidParams && connected) || loading}
              onClick={handleSubmit}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {buttonLabel}
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
