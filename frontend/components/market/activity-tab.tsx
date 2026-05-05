"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAdminRole } from "@/hooks/use-admin-role";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { USDC_DECIMALS, type Trade, formatUsdc } from "@/lib/types";
import { Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface ActivityTabProps {
  marketId?: string;
  marketCreator?: string;
}

export function ActivityTab({ marketId, marketCreator }: ActivityTabProps) {
  const [mine, setMine] = useState(false);
  const { publicKey } = useWallet();
  const walletAddress = publicKey?.toBase58();
  const { isSuperadmin, isAdmin } = useAdminRole();
  const canSeeUsernames = isSuperadmin || isAdmin;

  const { data, isLoading } = useQuery({
    queryKey: ["marketActivity", marketId],
    queryFn: () =>
      api.get<{ data: Trade[]; total: number }>(
        `/markets/${marketId}/history`,
        { limit: 100 },
      ),
    enabled: !!marketId,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const allTrades = useMemo(() => data?.data ?? [], [data]);

  // Build activity list: trades + synthetic initial liquidity
  const activities = useMemo(() => {
    const items: ActivityItem[] = allTrades.map((t) => ({
      type: t.isBuy ? "buy" : "sell",
      trader: t.trader,
      amount: t.collateralAmount,
      shares: t.tokensTransacted,
      fee: t.feePaid,
      outcomeIndex: t.outcomeIndex,
      mu: t.mu,
      sigma: t.sigma,
      timestamp: t.timestamp,
      txSignature: t.txSignature,
    }));

    // Add synthetic initial liquidity entry
    if (marketCreator && !mine) {
      items.push({
        type: "initial_lp",
        trader: marketCreator,
        amount: null,
        shares: null,
        fee: null,
        outcomeIndex: null,
        mu: null,
        sigma: null,
        timestamp: null,
        txSignature: null,
      });
    }

    return items;
  }, [allTrades, marketCreator, mine]);

  // Filter for "Mine" mode
  const filtered = useMemo(() => {
    if (!mine || !walletAddress) return activities;
    return activities.filter((a) => a.trader === walletAddress);
  }, [activities, mine, walletAddress]);

  if (!marketId) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        No market selected
      </div>
    );
  }

  return (
    <div>
      {/* Mine switch */}
      {walletAddress && (
        <div className="flex items-center justify-end gap-2 border-b border-border/20 px-4 py-2">
          <Label htmlFor="mine-switch" className="text-xs text-muted-foreground cursor-pointer">
            Mine
          </Label>
          <Switch
            id="mine-switch"
            checked={mine}
            onCheckedChange={setMine}
            className="scale-75"
          />
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-8">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading activity...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          {mine ? "No activity from your wallet" : "No activity yet"}
        </div>
      ) : (
        <div className="divide-y divide-border/20">
          {/* Header */}
          <div className="grid grid-cols-[80px_1fr_90px_90px_70px_80px] items-center gap-2 px-4 py-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span>Type</span>
            <span>Trader</span>
            <span className="text-right">Amount</span>
            <span className="text-right">Shares</span>
            <span className="text-right">Fee</span>
            <span className="text-right">Time</span>
          </div>
          {filtered.map((item, i) => (
            <ActivityRow
              key={item.txSignature ?? `lp-${i}`}
              item={item}
              isCurrentUser={item.trader === walletAddress}
              canSeeUsernames={canSeeUsernames}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ActivityItem {
  type: "buy" | "sell" | "initial_lp";
  trader: string;
  amount: string | null;
  shares: string | null;
  fee: string | null;
  outcomeIndex: number | null;
  mu: string | null;
  sigma: string | null;
  timestamp: string | null;
  txSignature: string | null;
}

function ActivityRow({
  item,
  isCurrentUser,
  canSeeUsernames,
}: {
  item: ActivityItem;
  isCurrentUser: boolean;
  canSeeUsernames: boolean;
}) {
  const typeLabel =
    item.type === "buy"
      ? "Buy"
      : item.type === "sell"
        ? "Sell"
        : "LP (Init)";

  const typeColor =
    item.type === "buy"
      ? "text-emerald-400"
      : item.type === "sell"
        ? "text-rose-400"
        : "text-blue-400";

  // Trader display: current user sees own name, admin/superadmin sees wallet prefix, others see "Trader#ID"
  const traderDisplay = isCurrentUser
    ? "You"
    : canSeeUsernames
      ? item.trader.slice(0, 4) + "..." + item.trader.slice(-4)
      : "Trader#" + item.trader.slice(-4);

  const amount =
    item.amount != null ? formatUsdc(item.amount) : "—";

  const shares =
    item.type === "initial_lp"
      ? "100%"
      : item.shares != null
        ? formatShares(Number(item.shares))
        : "—";

  const fee =
    item.fee != null ? formatUsdc(item.fee) : "—";

  const time =
    item.timestamp != null
      ? formatActivityTime(new Date(item.timestamp))
      : "Genesis";

  return (
    <div className="grid grid-cols-[80px_1fr_90px_90px_70px_80px] items-center gap-2 px-4 py-2.5 text-xs">
      <span className={cn("font-medium", typeColor)}>{typeLabel}</span>
      <span className="truncate text-muted-foreground" title={item.trader}>
        {traderDisplay}
      </span>
      <span className="text-right tabular-nums">{amount}</span>
      <span className="text-right tabular-nums">{shares}</span>
      <span className="text-right tabular-nums text-muted-foreground">{fee}</span>
      <span className="text-right text-muted-foreground">{time}</span>
    </div>
  );
}

function formatShares(raw: number): string {
  const n = raw / 10 ** USDC_DECIMALS;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(2);
}

function formatActivityTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;

  const today = new Date();
  const yesterday = new Date(now - 86_400_000);

  if (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth()
  ) {
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  if (
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth()
  ) {
    return "Yesterday";
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
