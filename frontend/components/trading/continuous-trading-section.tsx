"use client";

import { useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useConnection } from "@solana/wallet-adapter-react";
import { useQueryClient } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { Loader2, TrendingUp, TrendingDown, Wallet, RotateCcw } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InteractiveDistributionChart } from "./interactive-distribution-chart";
import { CostPreview } from "./cost-preview";
import { ClassicTradeModal } from "./classic-trade-modal";
import { MarketStatsBar } from "@/components/market/market-stats-bar";
import {
  MarketState,
  USDC_DECIMALS,
  SCALE,
  formatUsdc,
  type MarketDetail,
} from "@/lib/types";
import { useProgram } from "@/lib/solana";
import { useUserMarketPosition } from "@/hooks/use-user-position";
import { useTokenBalance } from "@/hooks/use-token-balance";
import { sliderToSigma } from "@/lib/normal";
import {
  executeBuyDistribution,
  executeSellDistribution,
} from "@/lib/transactions";
import {
  showTradeSuccess,
  showTradeError,
} from "@/components/common/transaction-toast";
import { cn } from "@/lib/utils";

interface ContinuousTradingSectionProps {
  market: MarketDetail;
}

export function ContinuousTradingSection({ market }: ContinuousTradingSectionProps) {
  const rangeMin = market.rangeMin != null ? Number(market.rangeMin) / SCALE : 0;
  const rangeMax = market.rangeMax != null ? Number(market.rangeMax) / SCALE : 100;
  const rangeWidth = rangeMax - rangeMin;

  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [mu, setMu] = useState<number | null>(null);
  const [sigma, setSigma] = useState(() => sliderToSigma(0.5, rangeWidth));
  const [amount, setAmount] = useState("");
  const [inputUnit, setInputUnit] = useState<"collateral" | "shares">("collateral");
  const [loading, setLoading] = useState(false);
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

  const isDisabled = market.state !== MarketState.Active;
  const hasValidParams = mu !== null && sigma > 0 && Number(amount) > 0;

  const isReverseUnit =
    (side === "buy" && inputUnit === "shares") ||
    (side === "sell" && inputUnit === "collateral");
  const needsEstimate = isReverseUnit && computedAmount == null && hasValidParams;

  const exceedsBalance =
    connected && side === "buy" && hasValidParams &&
    (inputUnit === "collateral"
      ? Number(amount) * 10 ** USDC_DECIMALS > collateralBalance
      : computedAmount != null && computedAmount > collateralBalance);

  const validationError = exceedsBalance ? "Insufficient USDC balance" : null;

  const handleEstimate = useCallback(
    (amt: number | null) => setComputedAmount(amt),
    [],
  );

  const handleReset = useCallback(() => {
    setMu(null);
    setAmount("");
    setComputedAmount(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!connected || !publicKey || !program) {
      setVisible(true);
      return;
    }
    if (mu === null || !amount || Number(amount) <= 0) return;

    setLoading(true);
    try {
      const marketPubkey = new PublicKey(market.pubkey);
      const unit = inputUnit;

      const isReverse =
        (side === "buy" && unit === "shares") ||
        (side === "sell" && unit === "collateral");

      let effectiveAmount = amount;
      if (isReverse && computedAmount != null) {
        const buffered = Math.ceil(computedAmount * 1.005);
        effectiveAmount = (buffered / 10 ** USDC_DECIMALS).toString();
      }

      let signature: string;
      if (side === "buy") {
        signature = await executeBuyDistribution(
          program, marketPubkey, publicKey, mu, sigma, effectiveAmount,
        );
      } else {
        signature = await executeSellDistribution(
          program, marketPubkey, publicKey, mu, sigma, effectiveAmount,
        );
      }

      try {
        const latestBlockhash = await connection.getLatestBlockhash();
        await connection.confirmTransaction(
          { signature, ...latestBlockhash },
          "confirmed",
        );
      } catch {
        // Confirmation timeout is non-fatal
      }

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

      handleReset();
    } catch (error) {
      showTradeError(error);
    } finally {
      setLoading(false);
    }
  }, [
    connected, publicKey, program, mu, sigma, amount, inputUnit, side,
    address, market.pubkey, market.id, market.collateralMint,
    computedAmount, connection, setVisible, queryClient, handleReset,
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
          onMuChange={setMu}
          onSigmaChange={setSigma}
        />

        {isDisabled ? (
          <div className="rounded-lg border border-dashed border-border/60 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              {market.state === MarketState.Resolved
                ? "This market has been resolved"
                : market.state === MarketState.Paused
                  ? "Trading is paused"
                  : "This market is pending resolution"}
            </p>
          </div>
        ) : (
          <>
            {/* Buy/Sell tabs */}
            <Tabs
              value={side}
              onValueChange={(v) => {
                setSide(v as "buy" | "sell");
                setAmount("");
                setComputedAmount(null);
                setInputUnit(v === "buy" ? "collateral" : "shares");
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

            {/* Amount input */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">
                  {side === "buy"
                    ? "Amount (USDC)"
                    : inputUnit === "shares"
                      ? "Shares to sell"
                      : "USDC to receive"}
                </label>
                {side === "sell" && (
                  <div className="flex rounded-md border border-border/60 bg-muted/20 text-[10px]">
                    {(["shares", "collateral"] as const).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => { setInputUnit(opt); setAmount(""); setComputedAmount(null); }}
                        className={cn(
                          "px-2 py-0.5 transition-colors first:rounded-l-md last:rounded-r-md",
                          inputUnit === opt
                            ? "bg-primary/20 text-primary font-medium"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {opt === "shares" ? "Shares" : "USDC"}
                      </button>
                    ))}
                  </div>
                )}
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
                  disabled={mu === null}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  {side === "buy" ? "USDC" : inputUnit === "shares" ? "shares" : "USDC"}
                </span>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                {side === "buy" && collateralBalance > 0 ? (
                  <span>Balance: {formatUsdc(collateralBalance)}</span>
                ) : (
                  <span />
                )}
                {side === "buy" && collateralBalance > 0 && (
                  <button
                    type="button"
                    onClick={() => setAmount((collateralBalance / 10 ** USDC_DECIMALS).toString())}
                    className="text-[11px] font-medium text-primary hover:text-primary/80"
                  >
                    Max
                  </button>
                )}
              </div>
            </div>

            {/* Cost preview */}
            {hasValidParams && mu !== null && (
              <CostPreview
                marketId={market.id}
                side={side}
                mu={mu}
                sigma={sigma}
                amount={amount}
                inputUnit={inputUnit}
                onEstimate={handleEstimate}
              />
            )}

            {validationError && (
              <p className="text-center text-xs text-rose-400">{validationError}</p>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-2">
              <Button
                className={cn(
                  "flex-1 transition-all",
                  connected && side === "buy" && "bg-emerald-600 hover:bg-emerald-700",
                  connected && side === "sell" && "bg-rose-600 hover:bg-rose-700",
                )}
                disabled={(!hasValidParams && connected) || loading || !!validationError || needsEstimate}
                onClick={handleSubmit}
              >
                {buttonIcon}
                {buttonLabel}
              </Button>

              {mu !== null && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleReset}
                  title="Reset Position"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              )}
            </div>

            {/* Classic trade modal */}
            <div className="flex justify-end">
              <ClassicTradeModal market={market} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
