"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useQueryClient } from "@tanstack/react-query";
import { useProgram } from "@/lib/solana";
import { useMarkets } from "@/hooks/use-markets";
import { executePauseMarket, executeUnpauseMarket } from "@/lib/admin-transactions";
import { showTradeSuccess, showTradeError } from "@/components/common/transaction-toast";
import { MarketStatus } from "@/components/market/market-status";
import { Button } from "@/components/ui/button";
import { MarketState } from "@/lib/types";
import { Loader2, Pause, Play } from "lucide-react";

interface PauseControlsProps {
  isSuperadmin: boolean;
}

export function PauseControls({ isSuperadmin }: PauseControlsProps) {
  const program = useProgram();
  const { publicKey } = useWallet();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useMarkets({ limit: 100 });

  const [actionId, setActionId] = useState<string | null>(null);

  const handlePause = async (marketPubkey: string, marketId: string) => {
    if (!program || !publicKey) return;
    setActionId(marketId);
    try {
      const sig = await executePauseMarket(
        program,
        publicKey,
        new PublicKey(marketPubkey),
        isSuperadmin,
      );
      showTradeSuccess(sig, "Market paused");
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["markets"] }), 3000);
    } catch (err) {
      showTradeError(err);
    } finally {
      setActionId(null);
    }
  };

  const handleUnpause = async (marketPubkey: string, marketId: string) => {
    if (!program || !publicKey) return;
    setActionId(marketId);
    try {
      const sig = await executeUnpauseMarket(
        program,
        publicKey,
        new PublicKey(marketPubkey),
        isSuperadmin,
      );
      showTradeSuccess(sig, "Market unpaused");
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["markets"] }), 3000);
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
          Market Controls
        </h3>
      </div>
      <div className="divide-y divide-border/40">
        {markets.map((market) => {
          const isProcessing = actionId === market.id;
          const canPause = market.state === MarketState.Active;
          const canUnpause = market.state === MarketState.Paused;

          return (
            <div
              key={market.id}
              className="flex items-center gap-3 px-5 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {market.title}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  ID: {market.id}
                </div>
              </div>
              <MarketStatus state={market.state} />
              {canPause && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => handlePause(market.pubkey, market.id)}
                  disabled={isProcessing}
                >
                  {isProcessing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Pause className="h-3.5 w-3.5" />
                  )}
                  Pause
                </Button>
              )}
              {canUnpause && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => handleUnpause(market.pubkey, market.id)}
                  disabled={isProcessing}
                >
                  {isProcessing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  Unpause
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
