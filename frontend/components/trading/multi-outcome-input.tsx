"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  computeProbabilities,
  formatProbability,
  type MarketDetail,
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

interface MultiOutcomeInputProps {
  market: MarketDetail;
  side: "buy" | "sell";
  onParamsChange: (params: { outcome: number; amount: string } | null) => void;
}

export function MultiOutcomeInput({
  market,
  side,
  onParamsChange,
}: MultiOutcomeInputProps) {
  const [selectedOutcome, setSelectedOutcome] = useState(0);
  const [amount, setAmount] = useState("");

  const probabilities = computeProbabilities(market.reserves, market.totalMinted);
  const labels =
    market.outcomeLabels ??
    Array.from({ length: market.numOutcomes }, (_, i) => `Outcome ${i + 1}`);

  useEffect(() => {
    if (amount && Number(amount) > 0) {
      onParamsChange({ outcome: selectedOutcome, amount });
    } else {
      onParamsChange(null);
    }
  }, [selectedOutcome, amount, onParamsChange]);

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

      {/* Amount input */}
      <div>
        <label className="mb-2 block text-xs font-medium text-muted-foreground">
          {side === "buy" ? "Amount (USDC)" : "Shares to sell"}
        </label>
        <div className="relative">
          <Input
            type="number"
            placeholder="0.00"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="pr-14"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {side === "buy" ? "USDC" : "shares"}
          </span>
        </div>
      </div>
    </div>
  );
}
