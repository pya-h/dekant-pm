"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useQueryClient } from "@tanstack/react-query";
import { useProgram } from "@/lib/solana";
import { useMarkets } from "@/hooks/use-markets";
import { executeCollectFees } from "@/lib/admin-transactions";
import { showTradeSuccess, showTradeError } from "@/components/common/transaction-toast";
import { MarketStatus } from "@/components/market/market-status";
import { Button } from "@/components/ui/button";
import { MarketState, formatUsdc } from "@/lib/types";
import { Loader2, Coins } from "lucide-react";

export function FeeCollector() {
  const program = useProgram();
  const { publicKey } = useWallet();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useMarkets({ limit: 100 });

  const [actionId, setActionId] = useState<string | null>(null);

  const handleCollect = async (marketPubkey: string, marketId: string) => {
    if (!program || !publicKey) return;
    setActionId(marketId);
    try {
      const sig = await executeCollectFees(
        program,
        publicKey,
        new PublicKey(marketPubkey),
      );
      showTradeSuccess(sig, "Fees collected");
      setTimeout(
        () => queryClient.invalidateQueries({ queryKey: ["markets"] }),
        3000,
      );
    } catch (err) {
      showTradeError(err);
    } finally {
      setActionId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center text-sm text-destructive">
        Failed to load markets
      </div>
    );
  }

  const markets = data?.data ?? [];

  // Show all markets — resolved ones are the primary targets but fees can accumulate on active ones too
  if (markets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        No markets found
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/40 bg-card/50">
      <div className="border-b border-border/40 px-5 py-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Collect Protocol Fees
        </h3>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Sweep accumulated fees from market vaults to the treasury. Superadmin only.
        </p>
      </div>
      <div className="divide-y divide-border/40">
        {markets.map((market) => {
          const isProcessing = actionId === market.id;

          return (
            <div
              key={market.id}
              className="flex items-center gap-3 px-5 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {market.title}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>ID: {market.id}</span>
                  <span>Volume: {formatUsdc(market.totalVolume)}</span>
                </div>
              </div>
              <MarketStatus state={market.state} />
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => handleCollect(market.pubkey, market.id)}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Coins className="h-3.5 w-3.5" />
                )}
                Collect
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
