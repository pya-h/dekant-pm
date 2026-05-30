"use client";

import { useFormContext } from "react-hook-form";
import type { CreateMarketFormData } from "@/lib/schemas/create-market-schema";
import { MarketType } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { useProtocolConfig } from "@/hooks/use-protocol-config";

const TYPE_LABELS: Record<number, string> = {
  [MarketType.Binary]: "Binary",
  [MarketType.MultiOutcome]: "Multi-Outcome",
  [MarketType.Continuous]: "Continuous",
};

export function StepReview() {
  const {
    getValues,
    formState: { errors },
  } = useFormContext<CreateMarketFormData>();
  const data = getValues();
  const { data: config } = useProtocolConfig();

  // Estimate creation fee
  const feeBps = config ? Number(config.creationFeeBps) : 0;
  const liquidityNum = parseFloat(data.initialLiquidity || "0");
  const feeAmount = (liquidityNum * feeBps) / 10_000;
  const netLiquidity = liquidityNum - feeAmount;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Review & Confirm</h2>
        <p className="text-sm text-muted-foreground">
          Verify all details before creating the market
        </p>
      </div>

      {Object.keys(errors).length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Please go back and fix validation errors before submitting.
        </div>
      )}

      <div className="space-y-3">
        <ReviewRow label="Market Type">
          {TYPE_LABELS[data.marketType] ?? "Unknown"}
        </ReviewRow>
        <ReviewRow label="Title">{data.title || "—"}</ReviewRow>
        {data.description && (
          <ReviewRow label="Description">{data.description}</ReviewRow>
        )}
        {data.category && (
          <ReviewRow label="Category">{toTitleCase(data.category)}</ReviewRow>
        )}
        {data.subject && (
          <ReviewRow label="Subject (Asset)">{data.subject}</ReviewRow>
        )}
        {data.tags && data.tags.length > 0 && (
          <ReviewRow label="Tags">
            <div className="flex flex-wrap gap-1">
              {data.tags.map((t) => (
                <Badge key={t} variant="outline" className="text-[11px]">
                  {t}
                </Badge>
              ))}
            </div>
          </ReviewRow>
        )}

        {/* Outcomes */}
        {data.marketType === MarketType.Binary && (
          <ReviewRow label="Outcomes">Yes / No</ReviewRow>
        )}
        {data.marketType === MarketType.MultiOutcome && data.outcomeLabels && (
          <ReviewRow label="Outcomes">
            {data.outcomeLabels.filter(Boolean).join(", ") || "—"}
          </ReviewRow>
        )}
        {data.marketType === MarketType.Continuous && (
          <>
            <ReviewRow label="Range">
              {data.rangeMin} – {data.rangeMax}
            </ReviewRow>
            <ReviewRow label="Bins">{data.numBins}</ReviewRow>
            <ReviewRow label="Kernel width">
              {(data.kernelWidth ?? 0) === 0
                ? "0 (winner-take-all)"
                : data.kernelWidth}
            </ReviewRow>
          </>
        )}

        <ReviewRow label="Deadline">
          {data.deadline
            ? new Date(data.deadline).toLocaleString()
            : "Not set"}
        </ReviewRow>
        <ReviewRow label="Oracle">{truncate(data.oracle)}</ReviewRow>
        <ReviewRow label="Collateral Mint">
          {truncate(data.collateralMint)}
        </ReviewRow>
        <ReviewRow label="Initial Liquidity">
          {liquidityNum.toFixed(2)} USDC
        </ReviewRow>

        {feeBps > 0 && (
          <>
            <ReviewRow label="Creation Fee">
              {feeAmount.toFixed(4)} USDC ({(feeBps / 100).toFixed(2)}%)
            </ReviewRow>
            <ReviewRow label="Net Liquidity">
              {netLiquidity.toFixed(4)} USDC
            </ReviewRow>
          </>
        )}
      </div>
    </div>
  );
}

function ReviewRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/30 bg-muted/10 px-3 py-2.5">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  );
}

function truncate(s: string): string {
  if (!s || s.length <= 12) return s || "Not set";
  return `${s.slice(0, 6)}...${s.slice(-6)}`;
}

function toTitleCase(value: string): string {
  if (!value) return value;
  return value
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}
