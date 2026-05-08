"use client";

import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { USDC_DECIMALS, type Trade, formatUsdc } from "@/lib/types";
import { Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";

const PAGE_SIZE = 30;

interface ActivityTabProps {
  marketId?: string;
  marketCreator?: string;
}

export function ActivityTab({ marketId, marketCreator }: ActivityTabProps) {
  const [mine, setMine] = useState(false);
  const { publicKey } = useWallet();
  const walletAddress = publicKey?.toBase58();
  const { token } = useAuth();

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["marketActivity", marketId, token, mine ? walletAddress : null],
    queryFn: ({ pageParam = 1 }) => {
      const params: Record<string, any> = { page: pageParam, limit: PAGE_SIZE };
      if (mine && walletAddress) params.trader = walletAddress;
      return api.get<{ data: Trade[]; total: number }>(
        `/markets/${marketId}/history`,
        params,
        token ?? undefined,
      );
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      const fetched = allPages.reduce((n, p) => n + p.data.length, 0);
      return fetched < lastPage.total ? allPages.length + 1 : undefined;
    },
    enabled: !!marketId,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const allTrades = useMemo(
    () => data?.pages.flatMap((p) => p.data) ?? [],
    [data],
  );

  // Build activity list: trades + synthetic initial liquidity
  const activities = useMemo(() => {
    const items: ActivityItem[] = allTrades.map((t) => ({
      type: t.isBuy ? "buy" : "sell",
      trader: t.trader,
      username: t.username,
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
        username: null,
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

  // When mine=true, filtering is done server-side via the trader query param
  const filtered = activities;

  // Infinite scroll sentinel
  const sentinelRef = useRef<HTMLDivElement>(null);
  const handleIntersect = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage],
  );

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(handleIntersect, {
      rootMargin: "100px",
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleIntersect]);

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
          <div className="grid grid-cols-[70px_1fr_80px_80px_80px_60px_70px] items-center gap-1.5 px-4 py-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span>Type</span>
            <span>User</span>
            <span>Wallet</span>
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
            />
          ))}
          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-1" />
          {isFetchingNextPage && (
            <div className="flex items-center justify-center gap-2 py-3">
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Loading more...</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ActivityItem {
  type: "buy" | "sell" | "initial_lp";
  trader: string;
  username: string | null;
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
}: {
  item: ActivityItem;
  isCurrentUser: boolean;
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

  // Username display: backend already masks for non-privileged callers
  const usernameDisplay = isCurrentUser
    ? "You"
    : item.username ?? "—";

  // Wallet display: backend already masks for non-privileged callers
  const walletDisplay = isCurrentUser
    ? "You"
    : item.trader.length > 12
      ? item.trader.slice(0, 4) + "..." + item.trader.slice(-4)
      : item.trader;

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
    <div className="grid grid-cols-[70px_1fr_80px_80px_80px_60px_70px] items-center gap-1.5 px-4 py-2.5 text-xs">
      <span className={cn("font-medium", typeColor)}>{typeLabel}</span>
      <span className="truncate text-muted-foreground" title={item.username ?? undefined}>
        {usernameDisplay}
      </span>
      <span className="truncate text-muted-foreground" title={item.trader}>
        {walletDisplay}
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
