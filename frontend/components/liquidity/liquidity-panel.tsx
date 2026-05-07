"use client";

import { useState, useCallback, useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useConnection } from "@solana/wallet-adapter-react";
import { useQueryClient } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { Loader2, Plus, Minus, Wallet, Droplets } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProgram } from "@/lib/solana";
import { useTokenBalance } from "@/hooks/use-token-balance";
import { useLpPositions } from "@/hooks/use-positions";
import { executeAddLiquidity, executeRemoveLiquidity } from "@/lib/transactions";
import {
  showTradeSuccess,
  showTradeError,
} from "@/components/common/transaction-toast";
import { MarketState, USDC_DECIMALS, formatUsdc, type MarketDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

interface LiquidityPanelProps {
  market: MarketDetail;
  trigger?: React.ReactNode;
}

export function LiquidityPanel({ market, trigger }: LiquidityPanelProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"add" | "remove">("add");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);

  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const { connection } = useConnection();
  const program = useProgram();
  const queryClient = useQueryClient();

  const address = publicKey?.toBase58();
  const { data: collateralBalance = 0 } = useTokenBalance(
    market.collateralMint,
    address,
  );
  const { data: lpPositions } = useLpPositions(address);

  const userLp = useMemo(
    () => lpPositions?.find((lp) => lp.marketId === market.id) ?? null,
    [lpPositions, market.id],
  );

  const userShares = userLp ? Number(userLp.shares) : 0;
  const totalShares = Number(market.lpSharesTotal);
  const totalMinted = Number(market.totalMinted);
  const lpFees = Number(market.lpFeeAccumulated);
  const userSharePct = totalShares > 0 ? (userShares / totalShares) * 100 : 0;
  const userFeeShare = totalShares > 0 ? (lpFees * userShares) / totalShares : 0;

  // Market state gating (matches on-chain constraints)
  const isExpired = new Date(market.deadline).getTime() < Date.now();
  const canAdd = market.state === MarketState.Active && !isExpired;
  const canRemove = market.state !== MarketState.Paused;

  const numAmount = Number(amount);
  const hasValidAmount = numAmount > 0;
  const MIN_LIQUIDITY_USDC = 1; // On-chain MIN_LIQUIDITY = 1_000_000 (1 USDC)

  // Estimate LP shares for deposit
  const estimatedShares = useMemo(() => {
    if (tab !== "add" || !hasValidAmount) return null;
    if (totalMinted === 0) return numAmount * 10 ** USDC_DECIMALS;
    const depositBase = numAmount * 10 ** USDC_DECIMALS;
    if (totalShares === 0) return depositBase;
    return (totalShares * depositBase) / totalMinted;
  }, [tab, hasValidAmount, numAmount, totalShares, totalMinted]);

  // Estimate USDC out for withdrawal
  const estimatedCollateralOut = useMemo(() => {
    if (tab !== "remove" || !hasValidAmount || totalShares === 0) return null;
    const pct = numAmount / 100;
    const sharesToBurn = Math.floor(userShares * pct);
    const collateralOut = (totalMinted * sharesToBurn) / totalShares;
    const feeShare = (lpFees * sharesToBurn) / totalShares;
    return { collateralOut, feeShare, total: collateralOut + feeShare, sharesToBurn };
  }, [tab, hasValidAmount, numAmount, userShares, totalShares, totalMinted, lpFees]);

  // Validation
  const marketStateError =
    tab === "add" && !canAdd
      ? isExpired
        ? "Market deadline has passed"
        : "Market is not active"
      : tab === "remove" && !canRemove
        ? "Market is paused"
        : null;

  const belowMinimum =
    connected && tab === "add" && hasValidAmount && numAmount < MIN_LIQUIDITY_USDC;

  const exceedsBalance =
    connected && tab === "add" && hasValidAmount &&
    numAmount * 10 ** USDC_DECIMALS > collateralBalance;

  const exceedsShares =
    connected && tab === "remove" && hasValidAmount && numAmount > 100;

  const noLpPosition =
    connected && tab === "remove" && userShares === 0;

  const validationError = marketStateError
    ?? (belowMinimum
      ? "Minimum deposit is 1 USDC"
      : exceedsBalance
        ? "Insufficient USDC balance"
        : exceedsShares
          ? "Cannot exceed 100%"
          : noLpPosition
            ? "No LP position to withdraw"
            : null);

  const handleSubmit = useCallback(async () => {
    if (!connected || !publicKey || !program) {
      setVisible(true);
      return;
    }
    if (!hasValidAmount) return;

    setLoading(true);
    try {
      const marketPubkey = new PublicKey(market.pubkey);
      let signature: string | undefined;

      if (tab === "add") {
        signature = await executeAddLiquidity(
          program,
          marketPubkey,
          publicKey,
          amount,
        );
      } else {
        // Convert percentage to shares using BigInt to avoid precision loss
        const rawShares = BigInt(userLp?.shares ?? "0");
        const sharesToBurn = new BN(
          (rawShares * BigInt(Math.round(numAmount * 100)) / BigInt(10000)).toString(),
        );
        signature = await executeRemoveLiquidity(
          program,
          marketPubkey,
          publicKey,
          sharesToBurn,
        );
      }

      if (!signature) return;

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

      showTradeSuccess(signature, tab === "add" ? "Add Liquidity" : "Remove Liquidity");
      const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ["market", market.id] });
        queryClient.invalidateQueries({ queryKey: ["markets"] });
        queryClient.invalidateQueries({ queryKey: ["lpPositions", address] });
        queryClient.invalidateQueries({ queryKey: ["tokenBalance", market.collateralMint, address] });
      };
      invalidate();
      setTimeout(invalidate, 3000);
      setAmount("");
    } catch (error) {
      showTradeError(error);
    } finally {
      setLoading(false);
    }
  }, [connected, publicKey, program, hasValidAmount, tab, amount, numAmount, userShares, market.pubkey, market.id, market.collateralMint, address, connection, setVisible, queryClient]);

  const buttonLabel = !connected
    ? "Connect Wallet"
    : loading
      ? "Confirming..."
      : tab === "add"
        ? "Add Liquidity"
        : "Remove Liquidity";

  const buttonIcon = !connected ? (
    <Wallet className="mr-2 h-4 w-4" />
  ) : loading ? (
    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
  ) : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="gap-1.5">
            <Droplets className="h-3.5 w-3.5" />
            Liquidity
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Liquidity Provision</DialogTitle>
        </DialogHeader>

        {/* Pool stats */}
        <div className="grid grid-cols-3 gap-2 rounded-lg border border-border/40 bg-muted/20 p-3 text-xs">
          <div className="text-center">
            <div className="text-muted-foreground">Pool Size</div>
            <div className="mt-0.5 font-medium tabular-nums">
              {formatUsdc(totalMinted)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-muted-foreground">Total LP Shares</div>
            <div className="mt-0.5 font-medium tabular-nums">
              {formatLpShares(totalShares)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-muted-foreground">LP Fees</div>
            <div className="mt-0.5 font-medium tabular-nums">
              {formatUsdc(lpFees)}
            </div>
          </div>
        </div>

        {/* User LP position */}
        {connected && userShares > 0 && (
          <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3 text-xs">
            <div className="mb-1 font-medium text-violet-400">Your LP Position</div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <div className="text-muted-foreground">Shares</div>
                <div className="mt-0.5 tabular-nums">{formatLpShares(userShares)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Pool Share</div>
                <div className="mt-0.5 tabular-nums">{userSharePct.toFixed(1)}%</div>
              </div>
              <div>
                <div className="text-muted-foreground">Fee Earnings</div>
                <div className="mt-0.5 tabular-nums">{formatUsdc(userFeeShare)}</div>
              </div>
            </div>
          </div>
        )}

        {/* Add / Remove tabs */}
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as "add" | "remove");
            setAmount("");
          }}
        >
          <TabsList className="w-full">
            <TabsTrigger value="add" className="flex-1 gap-1.5 data-[state=active]:text-emerald-400">
              <Plus className="h-3.5 w-3.5" />
              Add
            </TabsTrigger>
            <TabsTrigger value="remove" className="flex-1 gap-1.5 data-[state=active]:text-rose-400">
              <Minus className="h-3.5 w-3.5" />
              Remove
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Input */}
        <div className="space-y-2">
          {tab === "add" ? (
            <>
              <label className="text-xs text-muted-foreground">
                Amount (USDC)
              </label>
              <div className="relative">
                <Input
                  type="number"
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="pr-16"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
                  onClick={() => {
                    const max = collateralBalance / 10 ** USDC_DECIMALS;
                    setAmount(max > 0 ? max.toString() : "");
                  }}
                >
                  MAX
                </button>
              </div>
              {connected && (
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  Balance: {formatUsdc(collateralBalance)}
                </p>
              )}
            </>
          ) : (
            <>
              <label className="text-xs text-muted-foreground">
                Withdraw (% of your LP position)
              </label>
              <div className="relative">
                <Input
                  type="number"
                  placeholder="0"
                  min="0"
                  max="100"
                  step="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  %
                </span>
              </div>
              <div className="flex gap-1.5">
                {[25, 50, 75, 100].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    className={cn(
                      "flex-1 rounded-md border border-border/50 py-1 text-[11px] font-medium transition-colors hover:border-primary/40 hover:text-primary",
                      Number(amount) === pct && "border-primary/50 text-primary bg-primary/5",
                    )}
                    onClick={() => setAmount(String(pct))}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Estimate preview */}
        {tab === "add" && estimatedShares != null && hasValidAmount && (
          <div className="rounded-lg border border-border/30 bg-muted/10 p-3 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Est. LP Shares</span>
              <span className="tabular-nums">{formatLpShares(estimatedShares)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Est. Pool Share</span>
              <span className="tabular-nums">
                {((estimatedShares / (totalShares + estimatedShares)) * 100).toFixed(1)}%
              </span>
            </div>
          </div>
        )}

        {tab === "remove" && estimatedCollateralOut != null && hasValidAmount && (
          <div className="rounded-lg border border-border/30 bg-muted/10 p-3 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Collateral Out</span>
              <span className="tabular-nums">{formatUsdc(estimatedCollateralOut.collateralOut)}</span>
            </div>
            {estimatedCollateralOut.feeShare > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Fee Earnings</span>
                <span className="tabular-nums text-emerald-400">
                  +{formatUsdc(estimatedCollateralOut.feeShare)}
                </span>
              </div>
            )}
            <div className="flex justify-between border-t border-border/30 pt-1 font-medium">
              <span className="text-muted-foreground">Total</span>
              <span className="tabular-nums">{formatUsdc(estimatedCollateralOut.total)}</span>
            </div>
          </div>
        )}

        {/* Validation error */}
        {validationError && (
          <p className="text-center text-xs text-rose-400">{validationError}</p>
        )}

        {/* Submit */}
        <Button
          className={cn(
            "w-full transition-all",
            connected && tab === "add" && "bg-emerald-600 hover:bg-emerald-700",
            connected && tab === "remove" && "bg-rose-600 hover:bg-rose-700",
          )}
          disabled={(!hasValidAmount && connected) || loading || !!validationError}
          onClick={handleSubmit}
        >
          {buttonIcon}
          {buttonLabel}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function formatLpShares(raw: number): string {
  const n = raw / 10 ** USDC_DECIMALS;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(2);
}
