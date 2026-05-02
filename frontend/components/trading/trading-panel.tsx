"use client";

import { useState, useCallback, Component, type ReactNode, type ErrorInfo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useConnection } from "@solana/wallet-adapter-react";
import { useQueryClient } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { Loader2, TrendingUp, TrendingDown, Wallet } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BinaryInput } from "./binary-input";
import { MultiOutcomeInput } from "./multi-outcome-input";
import { DistributionInput } from "./distribution-input";
import { CostPreview } from "./cost-preview";
import { MarketType, MarketState, USDC_DECIMALS, SCALE, type MarketDetail } from "@/lib/types";
import { useProgram } from "@/lib/solana";
import { useUserMarketPosition } from "@/hooks/use-user-position";
import { useTokenBalance } from "@/hooks/use-token-balance";
import { BN } from "@coral-xyz/anchor";
import {
  executeBuy,
  executeSell,
  executeBuyDistribution,
  executeSellDistribution,
  executeBuyToPrice,
  executeSellToPrice,
} from "@/lib/transactions";
import {
  showTradeSuccess,
  showTradeError,
} from "@/components/common/transaction-toast";
import { cn } from "@/lib/utils";

type TradeParams =
  | { outcome: number; amount: string; inputUnit: "collateral" | "shares" | "target" }
  | { mu: number; sigma: number; amount: string; inputUnit: "collateral" | "shares" };

interface TradingPanelProps {
  market: MarketDetail;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class TradingPanelErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("TradingPanel error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <Card className="border-destructive/30">
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              Trading panel encountered an error.
            </p>
            <button
              className="mt-2 text-xs text-primary hover:underline"
              onClick={() => this.setState({ hasError: false })}
            >
              Try again
            </button>
          </CardContent>
        </Card>
      );
    }
    return this.props.children;
  }
}

export function TradingPanel({ market }: TradingPanelProps) {
  return (
    <TradingPanelErrorBoundary>
      <TradingPanelInner market={market} />
    </TradingPanelErrorBoundary>
  );
}

function TradingPanelInner({ market }: TradingPanelProps) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [params, setParams] = useState<TradeParams | null>(null);
  const [loading, setLoading] = useState(false);
  // For reverse trades: stores the computed amount from CostPreview's estimate
  const [computedAmount, setComputedAmount] = useState<number | null>(null);

  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const { connection } = useConnection();
  const program = useProgram();
  const queryClient = useQueryClient();

  const address = publicKey?.toBase58();
  const { data: position } = useUserMarketPosition(address, market.id);
  const { data: collateralBalance = 0 } = useTokenBalance(
    market.collateralMint,
    address,
  );

  const handleParamsChange = useCallback(
    (p: TradeParams | null) => {
      setParams(p);
      setComputedAmount(null); // Reset when params change; CostPreview will re-estimate
    },
    [],
  );

  const handleEstimate = useCallback(
    (amount: number | null) => setComputedAmount(amount),
    [],
  );

  const isDisabled = market.state !== MarketState.Active;
  const isContinuous = market.marketType === MarketType.Continuous;
  const isTargetPrice = params?.inputUnit === "target";
  const hasValidParams = params !== null && (
    isTargetPrice
      ? Number(params.amount) > 0 && Number(params.amount) < 100
      : Number(params.amount) > 0
  );

  const inputUnit = params?.inputUnit ?? (side === "buy" ? "collateral" : "shares");
  const isReverseUnit =
    (side === "buy" && inputUnit === "shares") ||
    (side === "sell" && inputUnit === "collateral");

  // Validation: exceeds balance / holdings (but still show CostPreview)
  // For reverse trades, use computedAmount from the estimate
  const exceedsBalance =
    connected &&
    side === "buy" &&
    hasValidParams &&
    (inputUnit === "collateral"
      ? Number(params!.amount) * 10 ** USDC_DECIMALS > collateralBalance
      : computedAmount != null && computedAmount > collateralBalance);

  const exceedsHoldings =
    connected &&
    side === "sell" &&
    hasValidParams &&
    position != null &&
    "outcome" in params! &&
    (() => {
      const holdings = Number(position.holdings[(params! as { outcome: number }).outcome] ?? "0");
      if (isTargetPrice) {
        // For sell-to-price, we can't know exact tokens needed upfront,
        // but we can reject if user holds 0 for the target outcome
        return holdings === 0;
      }
      return inputUnit === "shares"
        ? Number(params!.amount) * 10 ** USDC_DECIMALS > holdings
        : computedAmount != null && computedAmount > holdings;
    })();

  const validationError = exceedsBalance
    ? "Insufficient USDC balance"
    : exceedsHoldings
      ? "Insufficient holdings"
      : null;

  // For reverse and target-price trades, button needs estimate before submitting
  const needsEstimate = (isReverseUnit || isTargetPrice) && computedAmount == null && hasValidParams;

  const handleSubmit = useCallback(async () => {
    if (!connected || !publicKey || !program) {
      setVisible(true);
      return;
    }
    if (!params) return;

    setLoading(true);
    try {
      const marketPubkey = new PublicKey(market.pubkey);
      let signature: string | undefined;

      const unit = params.inputUnit ?? (side === "buy" ? "collateral" : "shares");

      // Target-price mode: call buyToPrice / sellToPrice directly
      if (unit === "target" && "outcome" in params && computedAmount != null) {
        const targetProbScaled = new BN(
          Math.round((Number(params.amount) / 100) * SCALE),
        );
        if (side === "buy") {
          // computedAmount = collateralNeeded (base units); add 0.5% slippage
          const maxCollateral = new BN(Math.ceil(computedAmount * 1.005));
          signature = await executeBuyToPrice(
            program,
            marketPubkey,
            publicKey,
            params.outcome,
            targetProbScaled,
            maxCollateral,
          );
        } else {
          // computedAmount = collateralOut (base units); subtract 0.5% slippage
          const minCollateralOut = new BN(Math.floor(computedAmount * 0.995));
          signature = await executeSellToPrice(
            program,
            marketPubkey,
            publicKey,
            params.outcome,
            targetProbScaled,
            minCollateralOut,
          );
        }
      } else {
        // For reverse trades, derive the actual amount from the estimate with 0.5% slippage buffer
        const isReverse =
          (side === "buy" && unit === "shares") ||
          (side === "sell" && unit === "collateral");

        let effectiveAmount = params.amount;
        if (isReverse && computedAmount != null) {
          // Add 0.5% buffer for slippage, convert back to human-readable
          const buffered = Math.ceil(computedAmount * 1.005);
          effectiveAmount = (buffered / 10 ** USDC_DECIMALS).toString();
        }

        if (side === "buy") {
          if (isContinuous && "mu" in params) {
            signature = await executeBuyDistribution(
              program,
              marketPubkey,
              publicKey,
              params.mu,
              params.sigma,
              effectiveAmount,
            );
          } else if ("outcome" in params) {
            signature = await executeBuy(
              program,
              marketPubkey,
              publicKey,
              params.outcome,
              effectiveAmount,
            );
          }
        } else {
          if (isContinuous && "mu" in params) {
            signature = await executeSellDistribution(
              program,
              marketPubkey,
              publicKey,
              params.mu,
              params.sigma,
              effectiveAmount,
            );
          } else if ("outcome" in params) {
            signature = await executeSell(
              program,
              marketPubkey,
              publicKey,
              params.outcome,
              effectiveAmount,
            );
          }
        }
      }

      if (!signature) return;

      // Wait for confirmation to prevent wallet hanging on next operation
      try {
        const latestBlockhash = await connection.getLatestBlockhash();
        await connection.confirmTransaction(
          { signature, ...latestBlockhash },
          "confirmed",
        );
      } catch {
        // Confirmation timeout is non-fatal — tx may still succeed
      }

      showTradeSuccess(signature, side === "buy" ? "Buy" : "Sell");

      // Refresh data
      const keys = [
        ["market", market.id],
        ["markets"],
        ["userPosition", address, market.id],
        ["userPositions", address],
        ["tokenBalance", market.collateralMint, address],
      ];
      for (const queryKey of keys) {
        queryClient.invalidateQueries({ queryKey });
      }
      // Delayed refresh to catch indexer processing lag
      setTimeout(() => {
        for (const queryKey of keys) {
          queryClient.invalidateQueries({ queryKey });
        }
      }, 3000);

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
    address,
    market.pubkey,
    market.id,
    market.collateralMint,
    isContinuous,
    computedAmount,
    connection,
    setVisible,
    queryClient,
  ]);

  const buttonLabel = !connected
    ? "Connect Wallet"
    : loading
      ? "Confirming..."
      : needsEstimate
        ? "Estimating..."
        : side === "buy"
          ? "Place Buy Order"
          : "Place Sell Order";

  const buttonIcon = !connected ? (
    <Wallet className="mr-2 h-4 w-4" />
  ) : loading || needsEstimate ? (
    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
  ) : null;

  return (
    <Card className={cn(
      "border-primary/20 transition-colors",
      side === "buy" && !isDisabled && "border-emerald-500/20",
      side === "sell" && !isDisabled && "border-rose-500/20",
    )}>
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
              setComputedAmount(null);
            }}
          >
            <TabsList className="w-full">
              <TabsTrigger value="buy" className="flex-1 gap-1.5 data-[state=active]:text-emerald-400">
                <TrendingUp className="h-3.5 w-3.5" />
                Buy
              </TabsTrigger>
              <TabsTrigger value="sell" className="flex-1 gap-1.5 data-[state=active]:text-rose-400">
                <TrendingDown className="h-3.5 w-3.5" />
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
          <>
            <DistributionInput
              market={market}
              side={side}
              onParamsChange={handleParamsChange}
              collateralBalance={collateralBalance}
              position={position ?? null}
            />

            {hasValidParams && params && "mu" in params && (
              <CostPreview
                marketId={market.id}
                side={side}
                mu={params.mu}
                sigma={params.sigma}
                amount={params.amount}
                inputUnit={params.inputUnit}
                onEstimate={handleEstimate}
              />
            )}

            {validationError && (
              <p className="text-center text-xs text-rose-400">{validationError}</p>
            )}

            <Button
              className={cn(
                "w-full transition-all",
                connected && side === "buy" && "bg-emerald-600 hover:bg-emerald-700",
                connected && side === "sell" && "bg-rose-600 hover:bg-rose-700",
              )}
              disabled={(!hasValidParams && connected) || loading || !!validationError || needsEstimate}
              onClick={handleSubmit}
            >
              {buttonIcon}
              {buttonLabel}
            </Button>
          </>
        ) : (
          <>
            {market.marketType === MarketType.Binary ? (
              <BinaryInput
                market={market}
                side={side}
                onParamsChange={handleParamsChange}
                collateralBalance={collateralBalance}
                position={position ?? null}
              />
            ) : (
              <MultiOutcomeInput
                market={market}
                side={side}
                onParamsChange={handleParamsChange}
                collateralBalance={collateralBalance}
                position={position ?? null}
              />
            )}

            {hasValidParams && params && "outcome" in params && (
              <CostPreview
                marketId={market.id}
                side={side}
                outcome={params.outcome}
                amount={params.amount}
                inputUnit={params.inputUnit}
                onEstimate={handleEstimate}
              />
            )}

            {validationError && (
              <p className="text-center text-xs text-rose-400">{validationError}</p>
            )}

            <Button
              className={cn(
                "w-full transition-all",
                connected && side === "buy" && "bg-emerald-600 hover:bg-emerald-700",
                connected && side === "sell" && "bg-rose-600 hover:bg-rose-700",
              )}
              disabled={(!hasValidParams && connected) || loading || !!validationError || needsEstimate}
              onClick={handleSubmit}
            >
              {buttonIcon}
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
