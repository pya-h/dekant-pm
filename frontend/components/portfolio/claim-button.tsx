"use client";

import { useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useQueryClient } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { Loader2, Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProgram } from "@/lib/solana";
import { executeClaimPayout } from "@/lib/transactions";
import {
  showTradeSuccess,
  showTradeError,
} from "@/components/common/transaction-toast";
import { formatUsdc, USDC_DECIMALS } from "@/lib/types";

interface ClaimButtonProps {
  marketPubkey: string;
  marketId: string;
  /** Estimated payout in USDC base units (raw) */
  estimatedPayout: number;
}

export function ClaimButton({
  marketPubkey,
  marketId,
  estimatedPayout,
}: ClaimButtonProps) {
  const [loading, setLoading] = useState(false);
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const program = useProgram();
  const queryClient = useQueryClient();

  const handleClaim = useCallback(async () => {
    if (!program || !publicKey) return;

    setLoading(true);
    try {
      const signature = await executeClaimPayout(
        program,
        new PublicKey(marketPubkey),
        publicKey,
      );

      // Wait for confirmation to prevent wallet hanging on next operation
      try {
        const latestBlockhash = await connection.getLatestBlockhash();
        await connection.confirmTransaction(
          { signature, ...latestBlockhash },
          "confirmed",
        );
      } catch {
        // Confirmation timeout is non-fatal
      }

      showTradeSuccess(signature, "Claim");
      const address = publicKey.toBase58();
      queryClient.invalidateQueries({ queryKey: ["userPositions"] });
      queryClient.invalidateQueries({ queryKey: ["userPosition", address, marketId] });
      queryClient.invalidateQueries({ queryKey: ["market", marketId] });
      queryClient.invalidateQueries({ queryKey: ["tokenBalance"] });
    } catch (error) {
      showTradeError(error);
    } finally {
      setLoading(false);
    }
  }, [program, publicKey, marketPubkey, marketId, connection, queryClient]);

  const payoutDisplay =
    estimatedPayout > 0
      ? formatUsdc(estimatedPayout)
      : null;

  return (
    <Button
      className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700"
      disabled={loading || !program}
      onClick={handleClaim}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Gift className="h-4 w-4" />
      )}
      {loading
        ? "Claiming..."
        : payoutDisplay
          ? `Claim ${payoutDisplay}`
          : "Claim Payout"}
    </Button>
  );
}
