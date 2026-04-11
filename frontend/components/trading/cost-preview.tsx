"use client";

import { useEffect, useState, useRef } from "react";
import { api } from "@/lib/api";
import { USDC_DECIMALS, SCALE } from "@/lib/types";

interface CostPreviewProps {
  marketId: string;
  side: "buy" | "sell";
  /** Human-readable amount (e.g. "10" for $10 USDC) */
  amount: string;
  outcome?: number;
  /** Distribution center (human-readable, for continuous markets) */
  mu?: number;
  /** Distribution width (human-readable, for continuous markets) */
  sigma?: number;
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

export function CostPreview({
  marketId,
  side,
  amount,
  outcome,
  mu,
  sigma,
}: CostPreviewProps) {
  type Estimate = BuyEstimate | DistributionBuyEstimate | SellEstimate;
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const requestIdRef = useRef(0);

  const isDistribution = mu !== undefined && sigma !== undefined;

  useEffect(() => {
    setError(null);

    const rawAmount = Math.floor(Number(amount) * 10 ** USDC_DECIMALS);
    if (!rawAmount || rawAmount <= 0) {
      setEstimate(null);
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      const currentRequestId = ++requestIdRef.current;
      setIsLoading(true);
      try {
        let res: Estimate;
        if (side === "buy") {
          if (isDistribution) {
            res = await api.post<DistributionBuyEstimate>(
              "/amm/estimate-buy",
              {
                marketId,
                mu: mu * SCALE,
                sigma: sigma * SCALE,
                amount: rawAmount,
              },
            );
          } else {
            res = await api.post<BuyEstimate>("/amm/estimate-buy", {
              marketId,
              outcome: outcome ?? 0,
              amount: rawAmount,
            });
          }
        } else {
          if (isDistribution) {
            res = await api.post<SellEstimate>("/amm/estimate-sell", {
              marketId,
              mu: mu! * SCALE,
              sigma: sigma! * SCALE,
              amount: rawAmount,
            });
          } else {
            res = await api.post<SellEstimate>("/amm/estimate-sell", {
              marketId,
              outcome: outcome ?? 0,
              amount: rawAmount,
            });
          }
        }
        // Only apply if this is still the latest request
        if (currentRequestId === requestIdRef.current) {
          setEstimate(res);
          setError(null);
        }
      } catch (err) {
        if (currentRequestId === requestIdRef.current) {
          setError(err instanceof Error ? err.message : "Estimation failed");
          setEstimate(null);
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
  }, [marketId, side, outcome, amount, mu, sigma, isDistribution]);

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
          {"tokensPerBin" in estimate ? (
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
            </>
          ) : "tokensOut" in estimate ? (
            <>
              <PreviewRow
                label="Shares received"
                value={formatTokens(
                  (estimate as BuyEstimate).tokensOut,
                )}
              />
              <PreviewRow
                label="Trade fee"
                value={formatUsdcRaw(estimate.fee)}
              />
              <PreviewRow
                label="Max payout"
                value={formatUsdcRaw(
                  (estimate as BuyEstimate).tokensOut,
                )}
                highlight
              />
            </>
          ) : "collateralOut" in estimate ? (
            <>
              <PreviewRow
                label="USDC received"
                value={formatUsdcRaw(
                  (estimate as SellEstimate).collateralOut,
                )}
                highlight
              />
              <PreviewRow
                label="Trade fee"
                value={formatUsdcRaw(estimate.fee)}
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
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={`text-xs font-medium tabular-nums ${highlight ? "text-emerald-400" : ""}`}
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
