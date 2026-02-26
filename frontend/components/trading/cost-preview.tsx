"use client";

import { useEffect, useState, useRef } from "react";
import { api } from "@/lib/api";
import { USDC_DECIMALS } from "@/lib/types";

interface CostPreviewProps {
  marketId: string;
  side: "buy" | "sell";
  outcome: number;
  /** Human-readable amount (e.g. "10" for $10 USDC) */
  amount: string;
}

interface BuyEstimate {
  tokensOut: number;
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
  outcome,
  amount,
}: CostPreviewProps) {
  const [estimate, setEstimate] = useState<BuyEstimate | SellEstimate | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    setError(null);

    const rawAmount = Math.floor(Number(amount) * 10 ** USDC_DECIMALS);
    if (!rawAmount || rawAmount <= 0) {
      setEstimate(null);
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      setIsLoading(true);
      try {
        if (side === "buy") {
          const res = await api.post<BuyEstimate>("/amm/estimate-buy", {
            marketId: Number(marketId),
            outcome,
            amount: rawAmount,
          });
          setEstimate(res);
        } else {
          const res = await api.post<SellEstimate>("/amm/estimate-sell", {
            marketId: Number(marketId),
            outcome,
            amount: rawAmount,
          });
          setEstimate(res);
        }
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Estimation failed");
        setEstimate(null);
      } finally {
        setIsLoading(false);
      }
    }, 200);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [marketId, side, outcome, amount]);

  if (!estimate && !isLoading && !error) return null;

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-sm">
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner />
          <span>Estimating...</span>
        </div>
      ) : error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : estimate ? (
        <dl className="space-y-1.5">
          {side === "buy" && "tokensOut" in estimate ? (
            <>
              <PreviewRow
                label="Shares received"
                value={formatTokens(estimate.tokensOut)}
              />
              <PreviewRow
                label="Trade fee"
                value={formatUsdcRaw(estimate.fee)}
              />
              <PreviewRow
                label="Max payout"
                value={formatUsdcRaw(estimate.tokensOut)}
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
