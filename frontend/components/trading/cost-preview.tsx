"use client";

import { useEffect, useState, useRef } from "react";
import { api } from "@/lib/api";
import { USDC_DECIMALS, SCALE } from "@/lib/types";

interface CostPreviewProps {
  marketId: string;
  side: "buy" | "sell";
  /** Human-readable amount (e.g. "10" for $10 USDC, 10 shares, or "70" for 70% in target mode) */
  amount: string;
  inputUnit?: "collateral" | "shares" | "target";
  outcome?: number;
  /** Distribution center (human-readable, for continuous markets) */
  mu?: number;
  /** Distribution width (human-readable, for continuous markets) */
  sigma?: number;
  /** Reports the computed amount (base units) for reverse/target trades, null for standard */
  onEstimate?: (computedAmount: number | null) => void;
  /** Display ticker for the collateral token (e.g. "USDC"). Defaults to "USDC". */
  tokenName?: string | null;
}

interface BuyEstimate {
  tokensOut: number;
  fee: number;
  newProbabilities: number[];
}

interface DistributionBuyEstimate {
  tokensPerBin: number[];
  fee: number;
  newProbabilities: number[];
}

interface SellEstimate {
  collateralOut: number;
  fee: number;
  newProbabilities: number[];
}

interface BuyBySharesEstimate {
  collateralNeeded: number;
  fee: number;
  newProbabilities: number[];
}

interface SellByCollateralEstimate {
  tokensNeeded: number;
  fee: number;
  newProbabilities: number[];
}

interface BuyToPriceEstimate {
  collateralNeeded: number;
  tokensOut: number;
  fee: number;
  newProbabilities: number[];
}

interface SellToPriceEstimate {
  tokensToSell: number;
  collateralOut: number;
  fee: number;
  newProbabilities: number[];
}

type Estimate =
  | BuyEstimate
  | DistributionBuyEstimate
  | SellEstimate
  | BuyBySharesEstimate
  | SellByCollateralEstimate
  | BuyToPriceEstimate
  | SellToPriceEstimate;

export function CostPreview({
  marketId,
  side,
  amount,
  inputUnit,
  outcome,
  mu,
  sigma,
  onEstimate,
  tokenName,
}: CostPreviewProps) {
  const ticker = tokenName || "USDC";
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const requestIdRef = useRef(0);

  const numericMarketId = Number(marketId);
  const isDistribution = mu !== undefined && sigma !== undefined;
  const unit = inputUnit ?? (side === "buy" ? "collateral" : "shares");
  const isTargetPrice = unit === "target";
  const isBuyByShares = side === "buy" && unit === "shares" && !isDistribution;
  const isSellByCollateral = side === "sell" && unit === "collateral";

  useEffect(() => {
    setError(null);

    // Validate input based on mode
    if (isTargetPrice) {
      const targetPct = Number(amount);
      if (isNaN(targetPct) || targetPct <= 0 || targetPct >= 100) {
        setEstimate(null);
        onEstimate?.(null);
        return;
      }
    } else {
      const rawAmount = Math.floor(Number(amount) * 10 ** USDC_DECIMALS);
      if (!rawAmount || rawAmount <= 0) {
        setEstimate(null);
        onEstimate?.(null);
        return;
      }
    }

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      const currentRequestId = ++requestIdRef.current;
      setIsLoading(true);
      try {
        let res: Estimate;
        let currentMode: string;

        if (isTargetPrice) {
          const targetProbability = Math.round(
            (Number(amount) / 100) * SCALE,
          );
          if (side === "buy") {
            res = await api.post<BuyToPriceEstimate>(
              "/amm/estimate-buy-to-price",
              {
                marketId: numericMarketId,
                outcome: outcome ?? 0,
                targetProbability,
              },
            );
            currentMode = "buyToPrice";
          } else {
            res = await api.post<SellToPriceEstimate>(
              "/amm/estimate-sell-to-price",
              {
                marketId: numericMarketId,
                outcome: outcome ?? 0,
                targetProbability,
              },
            );
            currentMode = "sellToPrice";
          }
        } else {
          const rawAmount = Math.floor(Number(amount) * 10 ** USDC_DECIMALS);

          if (isBuyByShares) {
            res = await api.post<BuyBySharesEstimate>(
              "/amm/estimate-buy-by-shares",
              {
                marketId: numericMarketId,
                outcome: outcome ?? 0,
                desiredTokens: rawAmount,
              },
            );
            currentMode = "buyByShares";
          } else if (isSellByCollateral) {
            res = await api.post<SellByCollateralEstimate>(
              "/amm/estimate-sell-by-collateral",
              isDistribution
                ? {
                    marketId: numericMarketId,
                    mu: mu! * SCALE,
                    sigma: sigma! * SCALE,
                    desiredCollateral: rawAmount,
                  }
                : {
                    marketId: numericMarketId,
                    outcome: outcome ?? 0,
                    desiredCollateral: rawAmount,
                  },
            );
            currentMode = "sellByCollateral";
          } else if (side === "buy") {
            if (isDistribution) {
              res = await api.post<DistributionBuyEstimate>(
                "/amm/estimate-buy",
                {
                  marketId: numericMarketId,
                  mu: mu * SCALE,
                  sigma: sigma * SCALE,
                  amount: rawAmount,
                },
              );
              currentMode = "distributionBuy";
            } else {
              res = await api.post<BuyEstimate>("/amm/estimate-buy", {
                marketId: numericMarketId,
                outcome: outcome ?? 0,
                amount: rawAmount,
              });
              currentMode = "buy";
            }
          } else {
            if (isDistribution) {
              res = await api.post<SellEstimate>("/amm/estimate-sell", {
                marketId: numericMarketId,
                mu: mu! * SCALE,
                sigma: sigma! * SCALE,
                amount: rawAmount,
              });
              currentMode = "distributionSell";
            } else {
              res = await api.post<SellEstimate>("/amm/estimate-sell", {
                marketId: numericMarketId,
                outcome: outcome ?? 0,
                amount: rawAmount,
              });
              currentMode = "sell";
            }
          }
        }

        if (currentRequestId === requestIdRef.current) {
          setEstimate(res);
          setMode(currentMode);
          setError(null);

          // Report computed amount for reverse/target trades
          if (currentMode === "buyToPrice") {
            onEstimate?.((res as BuyToPriceEstimate).collateralNeeded);
          } else if (currentMode === "sellToPrice") {
            onEstimate?.((res as SellToPriceEstimate).collateralOut);
          } else if (currentMode === "buyByShares") {
            onEstimate?.((res as BuyBySharesEstimate).collateralNeeded);
          } else if (currentMode === "sellByCollateral") {
            onEstimate?.((res as SellByCollateralEstimate).tokensNeeded);
          } else {
            onEstimate?.(null);
          }
        }
      } catch (err) {
        if (currentRequestId === requestIdRef.current) {
          setError(err instanceof Error ? err.message : "Estimation failed");
          setEstimate(null);
          onEstimate?.(null);
        }
      } finally {
        if (currentRequestId === requestIdRef.current) {
          setIsLoading(false);
        }
      }
    }, 200);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketId, side, outcome, amount, mu, sigma, isDistribution, isTargetPrice, isBuyByShares, isSellByCollateral]);

  if (!estimate && !isLoading && !error) return null;

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-sm animate-in fade-in-0 slide-in-from-bottom-2 duration-200">
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner />
          <span>Estimating...</span>
        </div>
      ) : error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : estimate ? (
        <dl className="space-y-1.5">
          {mode === "buyToPrice" && "collateralNeeded" in estimate ? (
            <>
              <PreviewRow
                label="Estimated cost"
                value={formatUsdcRaw(
                  (estimate as BuyToPriceEstimate).collateralNeeded,
                )}
                highlight
              />
              <PreviewRow
                label="Shares received"
                value={formatTokens(
                  (estimate as BuyToPriceEstimate).tokensOut,
                )}
              />
              <PreviewRow
                label="Trade fee"
                value={formatUsdcRaw(estimate.fee)}
              />
              <SlippageRow
                inputRaw={(estimate as BuyToPriceEstimate).collateralNeeded}
                outputRaw={(estimate as BuyToPriceEstimate).tokensOut}
                feeRaw={estimate.fee}
              />
            </>
          ) : mode === "sellToPrice" && "tokensToSell" in estimate ? (
            <>
              <PreviewRow
                label={`${ticker} received`}
                value={formatUsdcRaw(
                  (estimate as SellToPriceEstimate).collateralOut,
                )}
                highlight
              />
              <PreviewRow
                label="Shares to sell"
                value={formatTokens(
                  (estimate as SellToPriceEstimate).tokensToSell,
                )}
              />
              <PreviewRow
                label="Trade fee"
                value={formatUsdcRaw(estimate.fee)}
              />
              <SlippageRow
                inputRaw={(estimate as SellToPriceEstimate).tokensToSell}
                outputRaw={(estimate as SellToPriceEstimate).collateralOut}
                feeRaw={estimate.fee}
              />
            </>
          ) : mode === "buyByShares" && "collateralNeeded" in estimate ? (
            <>
              <PreviewRow
                label="Cost"
                value={formatUsdcRaw(
                  (estimate as BuyBySharesEstimate).collateralNeeded,
                )}
                highlight
              />
              <PreviewRow
                label="Trade fee"
                value={formatUsdcRaw(estimate.fee)}
              />
              <SlippageRow
                inputRaw={(estimate as BuyBySharesEstimate).collateralNeeded}
                outputRaw={Math.floor(Number(amount) * 10 ** USDC_DECIMALS)}
                feeRaw={estimate.fee}
              />
            </>
          ) : mode === "sellByCollateral" && "tokensNeeded" in estimate ? (
            <>
              <PreviewRow
                label="Shares to sell"
                value={formatTokens(
                  (estimate as SellByCollateralEstimate).tokensNeeded,
                )}
              />
              <PreviewRow
                label="Trade fee"
                value={formatUsdcRaw(estimate.fee)}
              />
              <SlippageRow
                inputRaw={(estimate as SellByCollateralEstimate).tokensNeeded}
                outputRaw={Math.floor(Number(amount) * 10 ** USDC_DECIMALS)}
                feeRaw={estimate.fee}
              />
            </>
          ) : mode === "distributionBuy" &&
            "tokensPerBin" in estimate ? (
            <>
              <PreviewRow
                label="Trade fee"
                value={formatUsdcRaw(estimate.fee)}
              />
              <PreviewRow
                label="Peak payout"
                value={formatUsdcRaw(
                  Math.max(
                    ...(estimate as DistributionBuyEstimate).tokensPerBin,
                  ),
                )}
                highlight
              />
              <SlippageRow
                inputRaw={Math.floor(Number(amount) * 10 ** USDC_DECIMALS)}
                outputRaw={
                  (estimate as DistributionBuyEstimate).tokensPerBin.reduce(
                    (sum, t) => sum + t,
                    0,
                  )
                }
                feeRaw={estimate.fee}
              />
            </>
          ) : mode === "buy" && "tokensOut" in estimate ? (
            <>
              <PreviewRow
                label="Shares received"
                value={formatTokens((estimate as BuyEstimate).tokensOut)}
              />
              <PreviewRow
                label="Trade fee"
                value={formatUsdcRaw(estimate.fee)}
              />
              <PreviewRow
                label="Max payout"
                value={formatUsdcRaw((estimate as BuyEstimate).tokensOut)}
                highlight
              />
              <SlippageRow
                inputRaw={Math.floor(Number(amount) * 10 ** USDC_DECIMALS)}
                outputRaw={(estimate as BuyEstimate).tokensOut}
                feeRaw={estimate.fee}
              />
            </>
          ) : "collateralOut" in estimate ? (
            <>
              <PreviewRow
                label={`${ticker} received`}
                value={formatUsdcRaw(
                  (estimate as SellEstimate).collateralOut,
                )}
                highlight
              />
              <PreviewRow
                label="Trade fee"
                value={formatUsdcRaw(estimate.fee)}
              />
              <SlippageRow
                inputRaw={Math.floor(Number(amount) * 10 ** USDC_DECIMALS)}
                outputRaw={(estimate as SellEstimate).collateralOut}
                feeRaw={estimate.fee}
              />
            </>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}

function PreviewRow({
  label,
  value,
  highlight,
  className,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  className?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={`text-xs font-medium tabular-nums ${highlight ? "text-emerald-400" : ""} ${className ?? ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin text-muted-foreground"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        className="opacity-25"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function formatTokens(raw: number): string {
  const n = raw / 10 ** USDC_DECIMALS;
  return `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} shares`;
}

function formatUsdcRaw(raw: number): string {
  const n = raw / 10 ** USDC_DECIMALS;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

/** Estimated slippage = how much worse the output is compared to the input, minus fees */
function SlippageRow({
  inputRaw,
  outputRaw,
  feeRaw,
}: {
  inputRaw: number;
  outputRaw: number;
  feeRaw: number;
}) {
  if (inputRaw <= 0 || outputRaw <= 0) return null;
  // Slippage: comparing input to output, accounting for the fee portion
  const effectiveInput = inputRaw - feeRaw;
  if (effectiveInput <= 0) return null;
  const slippage = Math.max(0, ((effectiveInput - outputRaw) / effectiveInput) * 100);
  const label = slippage < 0.01 ? "<0.01%" : `${slippage.toFixed(2)}%`;
  const color = slippage > 5 ? "text-rose-400" : slippage > 2 ? "text-amber-400" : "";
  return <PreviewRow label="Est. Slippage" value={label} className={color} />;
}
