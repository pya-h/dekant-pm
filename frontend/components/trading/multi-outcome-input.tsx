"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  computeProbabilities,
  formatProbability,
  formatUsdc,
  USDC_DECIMALS,
  type MarketDetail,
  type UserPosition,
} from "@/lib/types";

const OUTCOME_COLORS = [
  {
    border: "border-violet-500/50",
    bg: "bg-violet-500/10",
    text: "text-violet-400",
    dot: "bg-violet-500",
  },
  {
    border: "border-indigo-500/50",
    bg: "bg-indigo-500/10",
    text: "text-indigo-400",
    dot: "bg-indigo-500",
  },
  {
    border: "border-cyan-500/50",
    bg: "bg-cyan-500/10",
    text: "text-cyan-400",
    dot: "bg-cyan-500",
  },
  {
    border: "border-emerald-500/50",
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    dot: "bg-emerald-500",
  },
  {
    border: "border-amber-500/50",
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    dot: "bg-amber-500",
  },
  {
    border: "border-rose-500/50",
    bg: "bg-rose-500/10",
    text: "text-rose-400",
    dot: "bg-rose-500",
  },
  {
    border: "border-fuchsia-500/50",
    bg: "bg-fuchsia-500/10",
    text: "text-fuchsia-400",
    dot: "bg-fuchsia-500",
  },
  {
    border: "border-sky-500/50",
    bg: "bg-sky-500/10",
    text: "text-sky-400",
    dot: "bg-sky-500",
  },
];

type InputUnit = "collateral" | "shares" | "target";

interface MultiOutcomeInputProps {
  market: MarketDetail;
  side: "buy" | "sell";
  onParamsChange: (
    params: {
      outcome: number;
      amount: string;
      inputUnit: InputUnit;
    } | null,
  ) => void;
  collateralBalance?: number;
  position?: UserPosition | null;
}

export function MultiOutcomeInput({
  market,
  side,
  onParamsChange,
  collateralBalance,
  position,
}: MultiOutcomeInputProps) {
  const [selectedOutcome, setSelectedOutcome] = useState(0);
  const [amount, setAmount] = useState("");
  const [inputUnit, setInputUnit] = useState<InputUnit>(
    side === "buy" ? "collateral" : "shares",
  );

  const probabilities = computeProbabilities(market.reserves, market.totalMinted, market.kSquared);
  const labels =
    market.outcomeLabels ??
    Array.from({ length: market.numOutcomes }, (_, i) => `Outcome ${i + 1}`);

  // Reset inputUnit when side changes
  useEffect(() => {
    setInputUnit(side === "buy" ? "collateral" : "shares");
  }, [side]);

  useEffect(() => {
    if (inputUnit === "target") {
      const pct = Number(amount);
      if (amount && pct > 0 && pct < 100) {
        onParamsChange({ outcome: selectedOutcome, amount, inputUnit: "target" });
      } else {
        onParamsChange(null);
      }
    } else if (amount && Number(amount) > 0) {
      onParamsChange({ outcome: selectedOutcome, amount, inputUnit });
    } else {
      onParamsChange(null);
    }
  }, [selectedOutcome, amount, inputUnit, onParamsChange]);

  // Amount labels based on inputUnit
  const amountLabel =
    inputUnit === "target"
      ? "Target probability"
      : side === "buy"
        ? inputUnit === "collateral"
          ? "Amount (USDC)"
          : "Shares to buy"
        : inputUnit === "shares"
          ? "Shares to sell"
          : "USDC to receive";

  const amountSuffix =
    inputUnit === "target" ? "%" : inputUnit === "collateral" ? "USDC" : "shares";

  // For Max button and balance display
  const showBalance =
    side === "buy" && inputUnit === "collateral" && collateralBalance != null;
  const showAvailable =
    side === "sell" && inputUnit === "shares" && position != null;
  const availableShares = position
    ? Number(position.holdings[selectedOutcome] ?? "0")
    : 0;

  // Validation coloring (only for default-unit amounts, not target mode)
  const exceedsLimit =
    inputUnit !== "target" &&
    amount &&
    ((side === "buy" &&
      inputUnit === "collateral" &&
      collateralBalance != null &&
      Number(amount) * 10 ** USDC_DECIMALS > collateralBalance) ||
      (side === "sell" &&
        inputUnit === "shares" &&
        position != null &&
        Number(amount) * 10 ** USDC_DECIMALS > availableShares));

  return (
    <div className="space-y-4">
      {/* Outcome selection */}
      <div>
        <label className="mb-2 block text-xs font-medium text-muted-foreground">
          {side === "buy" ? "Buy outcome" : "Sell outcome"}
        </label>
        <div className="max-h-56 space-y-1.5 overflow-y-auto">
          {labels.map((label, i) => {
            const colors = OUTCOME_COLORS[i % OUTCOME_COLORS.length];
            const isSelected = selectedOutcome === i;
            return (
              <button
                key={i}
                onClick={() => setSelectedOutcome(i)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  isSelected
                    ? `${colors.border} ${colors.bg}`
                    : "border-border/60 hover:border-border hover:bg-muted/30",
                )}
              >
                <div
                  className={cn(
                    "h-3 w-3 shrink-0 rounded-full",
                    colors.dot,
                  )}
                />
                <span
                  className={cn(
                    "flex-1 truncate text-sm",
                    isSelected && colors.text,
                  )}
                >
                  {label}
                </span>
                <span className="text-sm font-medium tabular-nums text-muted-foreground">
                  {formatProbability(probabilities[i])}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Stacked probability bar */}
      <div className="flex h-2 w-full overflow-hidden rounded-full">
        {probabilities.map((p, i) => (
          <div
            key={i}
            className={cn(
              OUTCOME_COLORS[i % OUTCOME_COLORS.length].dot,
              "transition-all duration-300",
              selectedOutcome === i ? "opacity-100" : "opacity-40",
            )}
            style={{ width: `${Math.max(p * 100, 0.5)}%` }}
          />
        ))}
      </div>

      {/* Amount input with unit toggle */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">
            {amountLabel}
          </label>
          <UnitToggle
            options={
              side === "buy"
                ? [
                    { value: "collateral", label: "USDC" },
                    { value: "shares", label: "Shares" },
                    { value: "target", label: "Target" },
                  ]
                : [
                    { value: "shares", label: "Shares" },
                    { value: "collateral", label: "USDC" },
                    { value: "target", label: "Target" },
                  ]
            }
            value={inputUnit}
            onChange={(v) => {
              setInputUnit(v);
              setAmount("");
            }}
          />
        </div>
        <div className="relative">
          <Input
            type="number"
            placeholder={inputUnit === "target" ? "e.g. 70" : "0.00"}
            min={inputUnit === "target" ? "0.1" : "0"}
            max={inputUnit === "target" ? "99.9" : undefined}
            step={inputUnit === "target" ? "0.1" : "0.01"}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={cn("pr-14", exceedsLimit && "text-rose-400")}
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {amountSuffix}
          </span>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
          {inputUnit === "target" ? (
            <span>
              Current: {formatProbability(probabilities[selectedOutcome])}
            </span>
          ) : showBalance ? (
            <span>Balance: {formatUsdc(collateralBalance!)}</span>
          ) : showAvailable ? (
            <span>
              Available:{" "}
              {(availableShares / 10 ** USDC_DECIMALS).toFixed(2)} shares
            </span>
          ) : (
            <span />
          )}
          {inputUnit !== "target" &&
            ((showBalance && collateralBalance! > 0) ||
              (showAvailable && availableShares > 0)) && (
              <button
                type="button"
                onClick={() => {
                  if (showBalance) {
                    setAmount(
                      (collateralBalance! / 10 ** USDC_DECIMALS).toString(),
                    );
                  } else if (showAvailable) {
                    setAmount(
                      (availableShares / 10 ** USDC_DECIMALS).toString(),
                    );
                  }
                }}
                className="text-[11px] font-medium text-primary hover:text-primary/80"
              >
                Max
              </button>
            )}
        </div>
      </div>
    </div>
  );
}

function UnitToggle({
  options,
  value,
  onChange,
}: {
  options: { value: InputUnit; label: string }[];
  value: InputUnit;
  onChange: (v: InputUnit) => void;
}) {
  return (
    <div className="flex rounded-md border border-border/60 bg-muted/20 text-[10px]">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "px-2 py-0.5 transition-colors first:rounded-l-md last:rounded-r-md",
            value === opt.value
              ? "bg-primary/20 text-primary font-medium"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
