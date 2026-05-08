"use client";

import { useState, useCallback, /* useMemo, */ Component, type ReactNode, type ErrorInfo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useQueryClient } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { Loader2, TrendingUp, TrendingDown, Wallet, RotateCcw, LogOut } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BinaryInput } from "./binary-input";
import { MultiOutcomeInput } from "./multi-outcome-input";
import { DistributionInput } from "./distribution-input";
import { CostPreview } from "./cost-preview";
import { ClassicTradeModal } from "./classic-trade-modal";
import { LiquidityPanel } from "@/components/liquidity/liquidity-panel";
import { MarketType, MarketState, USDC_DECIMALS, SCALE, formatUsdc, type MarketDetail } from "@/lib/types";
import { useProgram } from "@/lib/solana";
import { useAdminRole } from "@/hooks/use-admin-role";
import { useUserMarketPosition } from "@/hooks/use-user-position";
import { useTokenBalance } from "@/hooks/use-token-balance";
import { useTokenName } from "@/hooks/use-token-name";
import { BN } from "@coral-xyz/anchor";
import {
  executeBuy,
  // executeSell,        // COMMENTED: sell simplification — sell side always uses sell_all
  executeBuyDistribution,
  // executeSellDistribution, // COMMENTED: sell simplification
  executeSellAll,
  executeBuyToPrice,
  // executeSellToPrice, // COMMENTED: sell simplification
} from "@/lib/transactions";
import {
  showTradeSuccess,
  showTradeError,
} from "@/components/common/transaction-toast";
// import { cn } from "@/lib/utils";           // COMMENTED: sell simplification
// import { computeBinWeights } from "@/lib/normal"; // COMMENTED: sell simplification

type TradeParams =
  | { outcome: number; amount: string; inputUnit: "collateral" | "shares" | "target" }
  | { mu: number; sigma: number; amount: string; inputUnit: "collateral" | "shares" };

interface TradingPanelProps {
  market: MarketDetail;
  distributionParams?: {
    mu: number | null;
    sigma: number;
    onReset: () => void;
    onSetMuSigma: (mu: number, sigma: number) => void;
  };
  /** Notifies parent when buy/sell side changes (used to lock chart on sell) */
  onSideChange?: (side: "buy" | "sell") => void;
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

export function TradingPanel({ market, distributionParams, onSideChange }: TradingPanelProps) {
  return (
    <TradingPanelErrorBoundary>
      <TradingPanelInner market={market} distributionParams={distributionParams} onSideChange={onSideChange} />
    </TradingPanelErrorBoundary>
  );
}

function TradingPanelInner({ market, distributionParams, onSideChange }: TradingPanelProps) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [params, setParams] = useState<TradeParams | null>(null);
  const [amount, setAmount] = useState("");
  const [inputUnit, setInputUnit] = useState<"collateral" | "shares">("collateral");
  const [loading, setLoading] = useState(false);
  const [computedAmount, setComputedAmount] = useState<number | null>(null);
  const [sellOutLocked, setSellOutLocked] = useState(false);

  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const program = useProgram();
  const queryClient = useQueryClient();
  const { isSuperadmin, isAdmin, isCreator } = useAdminRole();

  const address = publicKey?.toBase58();
  const { data: position } = useUserMarketPosition(address, market.id);
  const { data: collateralBalance = 0 } = useTokenBalance(
    market.collateralMint,
    address,
  );
  const { data: tokenName } = useTokenName(market.collateralMint);
  const ticker = tokenName || "USDC";

  const handleParamsChange = useCallback(
    (p: TradeParams | null) => {
      setParams(p);
      setComputedAmount(null);
    },
    [],
  );

  const handleEstimate = useCallback(
    (amt: number | null) => setComputedAmount(amt),
    [],
  );

  const isDisabled = market.state !== MarketState.Active;
  const isContinuous = market.marketType === MarketType.Continuous;

  // For continuous markets using interactive chart
  const hasDistParams = isContinuous && distributionParams != null;
  const chartMu = distributionParams?.mu ?? null;
  const chartSigma = distributionParams?.sigma ?? 1;

  // COMMENTED: rangeMin/rangeMax — no longer needed, sell side uses sell_all
  // const rangeMin = market.rangeMin != null ? Number(market.rangeMin) / SCALE : 0;
  // const rangeMax = market.rangeMax != null ? Number(market.rangeMax) / SCALE : 100;

  // COMMENTED: maxSellShares — no longer needed, sell side always uses sell_all
  // const maxSellShares = useMemo(() => {
  //   if (!hasDistParams || chartMu === null || side !== "sell" || !position) return 0;
  //   const weights = computeBinWeights(rangeMin, rangeMax, market.numOutcomes, chartMu, chartSigma);
  //   let max = Infinity;
  //   for (let i = 0; i < weights.length; i++) {
  //     if (weights[i] <= 0) continue;
  //     const holding = Number(position.holdings[i] ?? "0");
  //     max = Math.min(max, holding / weights[i]);
  //   }
  //   return max === Infinity ? 0 : Math.floor(max);
  // }, [hasDistParams, chartMu, chartSigma, side, position, rangeMin, rangeMax, market.numOutcomes]);

  // Whether the user has any holdings to sell (any market type)
  const hasPositionHoldings = position != null &&
    position.holdings.some((h) => Number(h) > 0);

  // Total tokens across all outcomes (for sell-entire-position display)
  const totalPositionTokens = position
    ? position.holdings.reduce((sum, h) => sum + Number(h), 0)
    : 0;

  // COMMENTED: handleSellOut — no longer needed, sell side always uses sell_all
  // const handleSellOut = useCallback(() => {
  //   if (!position || !distributionParams) return;
  //   const holdingsNum = position.holdings.map(Number);
  //   const totalTokens = holdingsNum.reduce((a, b) => a + b, 0);
  //   if (totalTokens === 0) return;
  //   distributionParams.onReset();
  //   setSide("sell");
  //   setInputUnit("shares");
  //   setComputedAmount(null);
  //   setAmount((totalTokens / 10 ** USDC_DECIMALS).toFixed(USDC_DECIMALS));
  //   setSellOutLocked(true);
  // }, [position, distributionParams]);

  // Validation for continuous (chart-based) mode
  const continuousHasValid = hasDistParams && chartMu !== null && Number(amount) > 0;
  const continuousInputUnit = inputUnit;
  const continuousIsReverse =
    (side === "buy" && continuousInputUnit === "shares") ||
    (side === "sell" && continuousInputUnit === "collateral");
  const continuousNeedsEstimate = continuousIsReverse && computedAmount == null && continuousHasValid;

  // Validation for discrete (binary/multi) mode
  const isTargetPrice = params?.inputUnit === "target";
  const discreteHasValid = params !== null && (
    isTargetPrice
      ? Number(params.amount) > 0 && Number(params.amount) < 100
      : Number(params.amount) > 0
  );

  const discreteInputUnit = params?.inputUnit ?? (side === "buy" ? "collateral" : "shares");
  const discreteIsReverse =
    (side === "buy" && discreteInputUnit === "shares") ||
    (side === "sell" && discreteInputUnit === "collateral");
  const discreteNeedsEstimate = (discreteIsReverse || isTargetPrice) && computedAmount == null && discreteHasValid;

  // Combined validation — sell side always uses sell_all (no estimation needed)
  const hasValidParams = side === "sell" ? hasPositionHoldings : (hasDistParams ? continuousHasValid : discreteHasValid);
  const needsEstimate = side === "sell" ? false : (hasDistParams ? continuousNeedsEstimate : discreteNeedsEstimate);

  const exceedsBalance =
    connected && side === "buy" && hasValidParams &&
    (() => {
      if (hasDistParams) {
        return continuousInputUnit === "collateral"
          ? Number(amount) * 10 ** USDC_DECIMALS > collateralBalance
          : computedAmount != null && computedAmount > collateralBalance;
      }
      return discreteInputUnit === "collateral"
        ? Number(params!.amount) * 10 ** USDC_DECIMALS > collateralBalance
        : computedAmount != null && computedAmount > collateralBalance;
    })();

  // COMMENTED: exceedsHoldings — sell side now always uses sell_all, no per-outcome validation needed
  // const exceedsHoldings =
  //   connected &&
  //   side === "sell" &&
  //   discreteHasValid &&
  //   !hasDistParams &&
  //   position != null &&
  //   "outcome" in params! &&
  //   (() => {
  //     const holdings = Number(position.holdings[(params! as { outcome: number }).outcome] ?? "0");
  //     if (isTargetPrice) return holdings === 0;
  //     return discreteInputUnit === "shares"
  //       ? Number(params!.amount) * 10 ** USDC_DECIMALS > holdings
  //       : computedAmount != null && computedAmount > holdings;
  //   })();

  const validationError = exceedsBalance
    ? `Insufficient ${ticker} balance`
    : null;

  const handleSubmit = useCallback(async () => {
    if (!connected || !publicKey || !program) {
      setVisible(true);
      return;
    }

    setLoading(true);
    try {
      const marketPubkey = new PublicKey(market.pubkey);
      let signature: string | undefined;

      // SIMPLIFIED SELL: always use sell_all for any market type
      if (side === "sell") {
        signature = await executeSellAll(program, marketPubkey, publicKey);
      } else if (hasDistParams && chartMu !== null) {
        // Continuous chart-based buy
        const isReverse = inputUnit === "shares";

        let effectiveAmount = amount;
        if (isReverse && computedAmount != null) {
          const buffered = Math.ceil(computedAmount * 1.005);
          effectiveAmount = (buffered / 10 ** USDC_DECIMALS).toString();
        }

        signature = await executeBuyDistribution(
          program, marketPubkey, publicKey, chartMu, chartSigma, effectiveAmount,
        );
      } else if (params) {
        const unit = params.inputUnit ?? "collateral";

        if ("mu" in params) {
          // Classic continuous buy (from DistributionInput in modal)
          const isReverse = unit === "shares";

          let effectiveAmount = params.amount;
          if (isReverse && computedAmount != null) {
            const buffered = Math.ceil(computedAmount * 1.005);
            effectiveAmount = (buffered / 10 ** USDC_DECIMALS).toString();
          }

          signature = await executeBuyDistribution(
            program, marketPubkey, publicKey, params.mu, params.sigma, effectiveAmount,
          );
        } else if (unit === "target" && "outcome" in params && computedAmount != null) {
          const targetProbScaled = new BN(
            Math.round((Number(params.amount) / 100) * SCALE),
          );
          const maxCollateral = new BN(Math.ceil(computedAmount * 1.005));
          signature = await executeBuyToPrice(
            program, marketPubkey, publicKey, params.outcome, targetProbScaled, maxCollateral,
          );
        } else {
          const isReverse = unit === "shares";

          let effectiveAmount = params.amount;
          if (isReverse && computedAmount != null) {
            const buffered = Math.ceil(computedAmount * 1.005);
            effectiveAmount = (buffered / 10 ** USDC_DECIMALS).toString();
          }

          if ("outcome" in params) {
            signature = await executeBuy(
              program, marketPubkey, publicKey, params.outcome, effectiveAmount,
            );
          }
        }
      } else {
        return;
      }

      if (!signature) return;

      showTradeSuccess(signature, side === "buy" ? "Buy" : "Sell");

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
      setTimeout(() => {
        for (const queryKey of keys) {
          queryClient.invalidateQueries({ queryKey });
        }
      }, 3000);

      // Reset form state after successful trade
      setAmount("");
      setComputedAmount(null);
      setSellOutLocked(false);
      setParams(null);
      if (hasDistParams) {
        distributionParams?.onReset();
      }
    } catch (error) {
      showTradeError(error);
    } finally {
      setLoading(false);
    }
  }, [
    connected, publicKey, program, params, side, address,
    market.pubkey, market.id, market.collateralMint,
    hasDistParams, chartMu, chartSigma, amount, inputUnit, sellOutLocked,
    computedAmount, setVisible, queryClient, distributionParams,
  ]);

  const buttonLabel = !connected
    ? "Connect Wallet"
    : loading
      ? "Confirming..."
      : needsEstimate
        ? "Estimating..."
        : side === "sell"
          ? "Sell Entire Position"
          : "Open Position";

  const buttonIcon = !connected ? (
    <Wallet className="mr-2 h-4 w-4" />
  ) : loading || needsEstimate ? (
    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
  ) : null;

  return (
    <Card data-tutorial="trading-panel" className="relative border-border/40 transition-colors min-h-[480px]">
      {/* Action buttons: Classic Trade + LP (admin only) */}
      {!isDisabled && (
        <div className="absolute right-3 top-3 flex items-center gap-1">
          {(isSuperadmin || isAdmin || isCreator) && (
            <LiquidityPanel market={market} />
          )}
          {hasDistParams && <ClassicTradeModal market={market} />}
        </div>
      )}

      <CardHeader className="pb-3">
        <h2 className="text-sm font-semibold">Open Position</h2>
        {hasDistParams && (
          <p className="text-[11px] text-muted-foreground">Distribution-based range bet</p>
        )}
        {!isDisabled && (
          <Tabs
            value={side}
            onValueChange={(v) => {
              const newSide = v as "buy" | "sell";
              setSide(newSide);
              setParams(null);
              setAmount("");
              setComputedAmount(null);
              setInputUnit(newSide === "buy" ? "collateral" : "shares");
              setSellOutLocked(newSide === "sell");
              if (newSide === "sell" && hasDistParams) {
                distributionParams?.onReset();
              }
              onSideChange?.(newSide);
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
        ) : side === "sell" ? (
          /* ── SELL SIDE: unified sell-entire-position for all market types ── */
          <>
            <div className="rounded-lg border border-dashed border-border/60 p-4 text-center space-y-2">
              {hasPositionHoldings ? (
                <>
                  <LogOut className="mx-auto h-5 w-5 text-rose-400" />
                  <p className="text-sm font-medium text-foreground">
                    Sell entire position
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Total: {formatUsdc(totalPositionTokens)} shares
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No position to sell
                </p>
              )}
            </div>

            <div className="space-y-3">
              <MarketInfoFields market={market} />
            </div>

            <Button
              className="w-full bg-rose-500 text-white font-semibold hover:bg-rose-400 transition-all"
              disabled={!hasPositionHoldings || !connected || loading}
              onClick={handleSubmit}
            >
              {buttonIcon}
              {buttonLabel}
            </Button>
          </>
        ) : hasDistParams ? (
          /* ── BUY SIDE: continuous chart-based ── */
          <>
            {chartMu === null && (
              <div className="rounded-lg border border-dashed border-border/60 p-4 text-center">
                <p className="text-xs text-muted-foreground">
                  Click on the chart to set your prediction
                </p>
              </div>
            )}

            {/* Amount input (buy only) */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">
                  Amount ({ticker})
                </label>
              </div>
              <div className="relative">
                <Input
                  type="number"
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => { setAmount(e.target.value); setComputedAmount(null); }}
                  className="pr-14"
                  disabled={chartMu === null}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  {ticker}
                </span>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                {collateralBalance > 0 ? (
                  <span>Balance: {formatUsdc(collateralBalance)} {ticker}</span>
                ) : (
                  <span />
                )}
                {collateralBalance > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setAmount((collateralBalance / 10 ** USDC_DECIMALS).toString());
                      setComputedAmount(null);
                    }}
                    className="text-[11px] font-medium text-primary hover:text-primary/80"
                  >
                    Max
                  </button>
                )}
              </div>
            </div>

            {/* Cost preview + validation + market info */}
            <div className="space-y-3">
              {continuousHasValid && chartMu !== null && (
                <CostPreview
                  marketId={market.id}
                  side={side}
                  mu={chartMu}
                  sigma={chartSigma}
                  amount={amount}
                  inputUnit={inputUnit}
                  onEstimate={handleEstimate}
                  tokenName={ticker}
                />
              )}
              {validationError && (
                <p className="text-center text-xs text-rose-400">{validationError}</p>
              )}
              <MarketInfoFields market={market} />
            </div>

            {/* Submit button */}
            <Button
              className="w-full bg-amber-500 text-black font-semibold hover:bg-amber-400 transition-all"
              disabled={(!hasValidParams && connected) || loading || !!validationError || needsEstimate}
              onClick={handleSubmit}
            >
              {buttonIcon}
              {buttonLabel}
            </Button>

            {/* Reset */}
            {chartMu !== null && (
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1.5 text-xs text-muted-foreground"
                onClick={() => {
                  distributionParams?.onReset();
                  setAmount("");
                  setComputedAmount(null);
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </Button>
            )}
          </>
        ) : isContinuous ? (
          /* ── BUY SIDE: continuous classic (modal) ── */
          <>
            <DistributionInput
              market={market}
              side={side}
              onParamsChange={handleParamsChange}
              collateralBalance={collateralBalance}
              tokenName={tokenName}
              position={position ?? null}
            />

            <div className="space-y-3">
              {discreteHasValid && params && "mu" in params && (
                <CostPreview
                  marketId={market.id}
                  side={side}
                  mu={params.mu}
                  sigma={params.sigma}
                  amount={params.amount}
                  inputUnit={params.inputUnit}
                  onEstimate={handleEstimate}
                  tokenName={ticker}
                />
              )}
              {validationError && (
                <p className="text-center text-xs text-rose-400">{validationError}</p>
              )}
              <MarketInfoFields market={market} />
            </div>

            <Button
              className="w-full bg-amber-500 text-black font-semibold hover:bg-amber-400 transition-all"
              disabled={(!hasValidParams && connected) || loading || !!validationError || needsEstimate}
              onClick={handleSubmit}
            >
              {buttonIcon}
              {buttonLabel}
            </Button>
          </>
        ) : (
          /* ── BUY SIDE: binary / multi ── */
          <>
            {market.marketType === MarketType.Binary ? (
              <BinaryInput
                market={market}
                side={side}
                onParamsChange={handleParamsChange}
                collateralBalance={collateralBalance}
                tokenName={tokenName}
                position={position ?? null}
              />
            ) : (
              <MultiOutcomeInput
                market={market}
                side={side}
                onParamsChange={handleParamsChange}
                collateralBalance={collateralBalance}
                tokenName={tokenName}
                position={position ?? null}
              />
            )}

            <div className="space-y-3">
              {discreteHasValid && params && "outcome" in params && (
                <CostPreview
                  marketId={market.id}
                  side={side}
                  outcome={params.outcome}
                  amount={params.amount}
                  inputUnit={params.inputUnit}
                  onEstimate={handleEstimate}
                  tokenName={ticker}
                />
              )}
              {validationError && (
                <p className="text-center text-xs text-rose-400">{validationError}</p>
              )}
              <MarketInfoFields market={market} />
            </div>

            <Button
              className="w-full bg-amber-500 text-black font-semibold hover:bg-amber-400 transition-all"
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

function MarketInfoFields({ market }: { market: MarketDetail }) {
  const reserves = market.reserves.map(Number);
  const totalReserves = reserves.reduce((sum, r) => sum + r, 0);
  const totalMinted = Number(market.totalMinted);

  // Liquidity Depth: measure of how spread out the reserves are
  // Uses normalized standard deviation of reserves: lower = deeper (more uniform)
  // Displayed as a qualitative label
  const n = reserves.length;
  let depthLabel = "Deep";
  if (n > 1 && totalReserves > 0) {
    const mean = totalReserves / n;
    const variance = reserves.reduce((s, r) => s + (r - mean) ** 2, 0) / n;
    const cv = Math.sqrt(variance) / mean; // coefficient of variation
    if (cv > 0.5) depthLabel = "Shallow";
    else if (cv > 0.2) depthLabel = "Medium";
    else depthLabel = "Deep";
  }

  return (
    <div className="mt-3 space-y-1 border-t border-border/30 pt-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Liquidity Depth</span>
        <span className={`text-xs font-medium ${depthLabel === "Deep" ? "text-emerald-400" : depthLabel === "Medium" ? "text-amber-400" : "text-rose-400"}`}>
          {depthLabel}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Market Liquidity</span>
        <span className="text-xs font-medium tabular-nums">
          {formatUsdc(totalMinted)}
        </span>
      </div>
    </div>
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
