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

type InputUnit = "collateral" | "shares" | "target";

interface BinaryInputProps {
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

export function BinaryInput({
  market,
  side,
  onParamsChange,
  collateralBalance,
  position,
}: BinaryInputProps) {
  const [selectedOutcome, setSelectedOutcome] = useState(0);
  const [amount, setAmount] = useState("");
  const [inputUnit, setInputUnit] = useState<InputUnit>(
    side === "buy" ? "collateral" : "shares",
  );

  const probabilities = computeProbabilities(
    market.reserves,
    market.totalMinted,
    market.kSquared,
  );
  const labels = market.outcomeLabels ?? ["Yes", "No"];

  // Reset inputUnit when side changes (React-recommended pattern)
  const [prevSide, setPrevSide] = useState(side);
  if (prevSide !== side) {
    setPrevSide(side);
    setInputUnit(side === "buy" ? "collateral" : "shares");
  }

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
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setSelectedOutcome(0)}
            className={cn(
              "flex flex-col items-center gap-1 rounded-lg border px-3 py-3 transition-colors",
              selectedOutcome === 0
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                : "border-border/60 text-muted-foreground hover:border-border hover:bg-muted/30",
            )}
          >
            <span className="text-sm font-semibold">{labels[0]}</span>
            <span className="text-lg font-bold tabular-nums">
              {formatProbability(probabilities[0])}
            </span>
          </button>
          <button
            onClick={() => setSelectedOutcome(1)}
            className={cn(
              "flex flex-col items-center gap-1 rounded-lg border px-3 py-3 transition-colors",
              selectedOutcome === 1
                ? "border-rose-500/50 bg-rose-500/10 text-rose-400"
                : "border-border/60 text-muted-foreground hover:border-border hover:bg-muted/30",
            )}
          >
            <span className="text-sm font-semibold">{labels[1]}</span>
            <span className="text-lg font-bold tabular-nums">
              {formatProbability(probabilities[1])}
            </span>
          </button>
        </div>
      </div>

      {/* Probability bar */}
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500 ease-out"
          style={{ width: `${probabilities[0] * 100}%` }}
        />
        <div
          className="bg-rose-500/30 transition-all duration-500 ease-out"
          style={{ width: `${probabilities[1] * 100}%` }}
        />
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

      {/* Contextual label */}
      <p className="text-center text-xs text-muted-foreground">
        {inputUnit === "target" && amount
          ? `Move "${labels[selectedOutcome]}" to ${amount}%`
          : selectedOutcome === 0
            ? `You think "${labels[0]}" is more likely`
            : `You think "${labels[1]}" is more likely`}
      </p>
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
