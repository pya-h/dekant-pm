"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { useQueryClient } from "@tanstack/react-query";
import { useProgram } from "@/lib/solana";
import { executeResolveMarket } from "@/lib/transactions";
import {
  showTradeSuccess,
  showTradeError,
} from "@/components/common/transaction-toast";
import type { MarketSummary } from "@/lib/types";
import { MarketType, SCALE } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, AlertTriangle } from "lucide-react";

interface ResolveFormProps {
  market: MarketSummary;
}

export function ResolveForm({ market }: ResolveFormProps) {
  const program = useProgram();
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const queryClient = useQueryClient();

  // Binary: selected outcome (0 or 1)
  // Multi: selected outcome index
  // Continuous: resolved value as string
  const [selectedOutcome, setSelectedOutcome] = useState<number | null>(null);
  const [continuousValue, setContinuousValue] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const rangeMin =
    market.rangeMin !== null ? Number(market.rangeMin) / SCALE : null;
  const rangeMax =
    market.rangeMax !== null ? Number(market.rangeMax) / SCALE : null;

  const outcomeLabels =
    market.outcomeLabels ?? Array.from({ length: market.numOutcomes }, (_, i) => `Outcome ${i}`);

  // Validation
  function getValidation(): { valid: boolean; error?: string } {
    if (market.marketType === MarketType.Continuous) {
      const val = parseFloat(continuousValue);
      if (isNaN(val) || continuousValue.trim() === "") {
        return { valid: false, error: "Enter a numeric value" };
      }
      if (rangeMin !== null && val < rangeMin) {
        return { valid: false, error: `Value must be >= ${rangeMin}` };
      }
      if (rangeMax !== null && val > rangeMax) {
        return { valid: false, error: `Value must be <= ${rangeMax}` };
      }
      return { valid: true };
    }
    if (selectedOutcome === null) {
      return { valid: false, error: "Select an outcome" };
    }
    return { valid: true };
  }

  function getResolutionLabel(): string {
    if (market.marketType === MarketType.Continuous) {
      return `Value: ${continuousValue}`;
    }
    if (selectedOutcome !== null) {
      return outcomeLabels[selectedOutcome] ?? `Outcome #${selectedOutcome}`;
    }
    return "—";
  }

  function handleResolveClick() {
    const { valid } = getValidation();
    if (!valid) return;
    setConfirmOpen(true);
  }

  async function handleConfirm() {
    if (!program || !publicKey) return;

    setIsSubmitting(true);
    try {
      const marketPubkey = new PublicKey(market.pubkey);

      let outcome: number;
      let value: BN;

      if (market.marketType === MarketType.Continuous) {
        // For continuous markets, outcome is ignored on-chain (computed from value)
        // Set outcome to 0 as placeholder
        outcome = 0;
        // Parse decimal string to SCALE-denominated integer without float precision loss.
        // e.g. "123.456789012" → "123456789012" (9 decimal places = SCALE)
        value = decimalToScaledBN(continuousValue);
      } else {
        outcome = selectedOutcome!;
        value = new BN(0);
      }

      const sig = await executeResolveMarket(
        program,
        marketPubkey,
        publicKey,
        outcome,
        value,
      );

      // Wait for confirmation to prevent wallet hanging on next operation
      try {
        const latestBlockhash = await connection.getLatestBlockhash();
        await connection.confirmTransaction(
          { signature: sig, ...latestBlockhash },
          "confirmed",
        );
      } catch {
        // Confirmation timeout is non-fatal
      }

      showTradeSuccess(sig, "Market resolved");
      setConfirmOpen(false);

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ["markets"] });
      queryClient.invalidateQueries({ queryKey: ["market", market.id] });

      // Delayed re-invalidation for indexer lag
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["markets"] });
        queryClient.invalidateQueries({ queryKey: ["market", market.id] });
      }, 3000);
    } catch (error) {
      showTradeError(error);
    } finally {
      setIsSubmitting(false);
    }
  }

  const validation = getValidation();

  return (
    <div className="space-y-3">
      {/* Binary: Yes/No buttons */}
      {market.marketType === MarketType.Binary && (
        <div className="flex gap-3">
          <Button
            variant={selectedOutcome === 0 ? "default" : "outline"}
            className={
              selectedOutcome === 0
                ? "flex-1 bg-green-600 hover:bg-green-700"
                : "flex-1"
            }
            onClick={() => setSelectedOutcome(0)}
          >
            {outcomeLabels[0] ?? "Yes"}
          </Button>
          <Button
            variant={selectedOutcome === 1 ? "default" : "outline"}
            className={
              selectedOutcome === 1
                ? "flex-1 bg-red-600 hover:bg-red-700"
                : "flex-1"
            }
            onClick={() => setSelectedOutcome(1)}
          >
            {outcomeLabels[1] ?? "No"}
          </Button>
        </div>
      )}

      {/* Multi-outcome: selectable list */}
      {market.marketType === MarketType.MultiOutcome && (
        <div className="grid gap-2 sm:grid-cols-2">
          {outcomeLabels.map((label, i) => (
            <Button
              key={i}
              variant={selectedOutcome === i ? "default" : "outline"}
              className="justify-start"
              onClick={() => setSelectedOutcome(i)}
            >
              <span className="mr-2 font-mono text-xs text-muted-foreground">
                #{i}
              </span>
              {label}
            </Button>
          ))}
        </div>
      )}

      {/* Continuous: numeric input */}
      {market.marketType === MarketType.Continuous && (
        <div className="space-y-2">
          <label className="text-sm font-medium">
            Resolved Value
            {rangeMin !== null && rangeMax !== null && (
              <span className="ml-2 font-normal text-muted-foreground">
                ({rangeMin} &ndash; {rangeMax})
              </span>
            )}
          </label>
          <Input
            type="number"
            placeholder={
              rangeMin !== null && rangeMax !== null
                ? `Enter value between ${rangeMin} and ${rangeMax}`
                : "Enter resolved value"
            }
            value={continuousValue}
            onChange={(e) => setContinuousValue(e.target.value)}
            step="any"
            min={rangeMin ?? undefined}
            max={rangeMax ?? undefined}
          />
          {continuousValue && !validation.valid && (
            <p className="text-xs text-destructive">{validation.error}</p>
          )}
        </div>
      )}

      {/* Resolve button */}
      <Button
        onClick={handleResolveClick}
        disabled={!validation.valid || isSubmitting}
        className="w-full"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Resolving...
          </>
        ) : (
          "Resolve Market"
        )}
      </Button>

      {/* Confirmation dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Confirm Resolution
            </DialogTitle>
            <DialogDescription>
              This action cannot be undone. Once resolved, traders will be able
              to claim payouts based on the resolved outcome.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 rounded-lg border border-border/50 bg-muted/30 px-4 py-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Market</span>
              <span className="max-w-[60%] truncate font-medium">
                {market.title}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Resolution</span>
              <span className="font-semibold text-primary">
                {getResolutionLabel()}
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={isSubmitting}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Resolving...
                </>
              ) : (
                "Confirm Resolution"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Convert a decimal string to a BN scaled by SCALE (10^9) without
 * intermediate floating-point — avoids precision loss for values with
 * many fractional digits.
 */
function decimalToScaledBN(input: string): BN {
  const SCALE_DIGITS = 9;
  const trimmed = input.trim();
  const negative = trimmed.startsWith("-");
  const abs = negative ? trimmed.slice(1) : trimmed;

  const [whole = "0", frac = ""] = abs.split(".");
  // Pad or truncate fractional part to exactly SCALE_DIGITS digits
  const padded = (frac + "0".repeat(SCALE_DIGITS)).slice(0, SCALE_DIGITS);
  const combined = whole + padded;
  // Remove leading zeros but keep at least "0"
  const cleaned = combined.replace(/^0+/, "") || "0";
  return negative ? new BN(cleaned).neg() : new BN(cleaned);
}
