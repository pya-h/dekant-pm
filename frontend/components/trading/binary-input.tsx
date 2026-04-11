"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  computeProbabilities,
  formatProbability,
  type MarketDetail,
} from "@/lib/types";

interface BinaryInputProps {
  market: MarketDetail;
  side: "buy" | "sell";
  onParamsChange: (params: { outcome: number; amount: string } | null) => void;
}

export function BinaryInput({
  market,
  side,
  onParamsChange,
}: BinaryInputProps) {
  const [selectedOutcome, setSelectedOutcome] = useState(0);
  const [amount, setAmount] = useState("");

  const probabilities = computeProbabilities(market.reserves, market.totalMinted, market.kSquared);
  const labels = market.outcomeLabels ?? ["Yes", "No"];

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

      {/* Contextual label */}
      <p className="text-center text-xs text-muted-foreground">
        {selectedOutcome === 0
          ? `You think "${labels[0]}" is more likely`
          : `You think "${labels[1]}" is more likely`}
      </p>
    </div>
  );
}
