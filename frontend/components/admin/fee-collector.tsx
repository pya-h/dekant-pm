"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useQueryClient } from "@tanstack/react-query";
import { useProgram } from "@/lib/solana";
import { useAllMarkets } from "@/hooks/use-markets";
import { executeCollectFees } from "@/lib/admin-transactions";
import { showTradeSuccess, showTradeError } from "@/components/common/transaction-toast";
import { MarketStatus } from "@/components/market/market-status";
import { Button } from "@/components/ui/button";
import { formatUsdc } from "@/lib/types";
import { Loader2, Coins } from "lucide-react";

export function FeeCollector() {
  const program = useProgram();
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const queryClient = useQueryClient();
  const { data: allMarkets, isLoading, isError } = useAllMarkets();

  const [actionId, setActionId] = useState<string | null>(null);
  const [collectingAll, setCollectingAll] = useState(false);

  const confirmTx = async (sig: string) => {
    try {
      const latestBlockhash = await connection.getLatestBlockhash();
      await connection.confirmTransaction({ signature: sig, ...latestBlockhash }, "confirmed");
    } catch {
      // Confirmation timeout is non-fatal
    }
  };

  const handleCollect = async (marketPubkey: string, marketId: string) => {
    if (!program || !publicKey) return;
    setActionId(marketId);
    try {
      const sig = await executeCollectFees(
        program,
        publicKey,
        new PublicKey(marketPubkey),
      );
      await confirmTx(sig);
      showTradeSuccess(sig, "Fees collected");
      setTimeout(
        () => queryClient.invalidateQueries({ queryKey: ["marketsAll"] }),
        3000,
      );
    } catch (err) {
      showTradeError(err);
    } finally {
      setActionId(null);
    }
  };

  const handleCollectAll = async () => {
    if (!program || !publicKey || !allMarkets?.length) return;
    setCollectingAll(true);

    try {
      // Pre-filter by backend data (quick local filter)
      const candidates = allMarkets.filter(
        (m) => Number(m.protocolFeeAccumulated ?? 0) > 0,
      );
      if (candidates.length === 0) {
        setCollectingAll(false);
        return;
      }

      // Batch-fetch on-chain accounts to verify actual fees (single RPC call)
      const pubkeys = candidates.map((m) => new PublicKey(m.pubkey));
      const onChainAccounts = await program.account.market.fetchMultiple(pubkeys);

      // Only collect from markets with actual on-chain fees > 0
      const marketsWithFees = candidates.filter((_, i) => {
        const account = onChainAccounts[i];
        if (!account) return false;
        const raw = account.protocolFeeAccumulated as { toNumber?: () => number };
        const fees = raw.toNumber?.() ?? Number(account.protocolFeeAccumulated);
        return fees > 0;
      });

      if (marketsWithFees.length === 0) {
        const { toast } = await import("sonner");
        toast.info("No markets have on-chain fees to collect");
        setCollectingAll(false);
        return;
      }

      let succeeded = 0;
      let failed = 0;

      for (const market of marketsWithFees) {
        setActionId(market.id);
        try {
          const sig = await executeCollectFees(
            program,
            publicKey,
            new PublicKey(market.pubkey),
          );
          await confirmTx(sig);
          succeeded++;
        } catch {
          failed++;
        }
      }

      setActionId(null);
      if (succeeded > 0) {
        const { toast } = await import("sonner");
        toast.success(
          `Collected fees from ${succeeded} market${succeeded > 1 ? "s" : ""}${failed > 0 ? ` (${failed} failed)` : ""}`,
        );
        setTimeout(
          () => queryClient.invalidateQueries({ queryKey: ["marketsAll"] }),
          3000,
        );
      } else if (failed > 0) {
        showTradeError(new Error(`All ${failed} fee collections failed`));
      }
    } catch (err) {
      showTradeError(err);
    } finally {
      setActionId(null);
      setCollectingAll(false);
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

  const markets = allMarkets ?? [];

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
      <div className="flex flex-col gap-3 border-b border-border/40 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Collect Protocol Fees
          </h3>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Sweep accumulated fees from market vaults to the treasury.
          </p>
        </div>
        <Button
          variant="default"
          size="sm"
          className="gap-1.5"
          onClick={handleCollectAll}
          disabled={collectingAll || !!actionId}
        >
          {collectingAll ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Coins className="h-3.5 w-3.5" />
          )}
          {collectingAll ? "Collecting..." : "Collect All"}
        </Button>
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
                  <span>Fees: {formatUsdc(market.protocolFeeAccumulated ?? "0")}</span>
                </div>
              </div>
              <MarketStatus state={market.state} />
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => handleCollect(market.pubkey, market.id)}
                disabled={isProcessing || collectingAll}
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
