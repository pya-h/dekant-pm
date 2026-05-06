"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { MiniChart } from "./mini-chart";
import { MarketAssetIcon } from "./market-asset-icon";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { EditMarketModal } from "./edit-market-modal";
import { MarketPropertiesModal } from "./market-properties-modal";
import { useAuth } from "@/hooks/use-auth";
import {
  type MarketSummary,
  formatUsdc,
} from "@/lib/types";
import { Pencil, Info } from "lucide-react";

interface MarketCardProps {
  market: MarketSummary;
  isCreator?: boolean;
  onMarketUpdated?: () => void;
}

export function MarketCard({ market, isCreator, onMarketUpdated }: MarketCardProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [propsOpen, setPropsOpen] = useState(false);
  const { token, authenticate } = useAuth();

  const handleEdit = useCallback(async () => {
    if (!token) await authenticate();
    setEditOpen(true);
  }, [token, authenticate]);

  const handleProperties = useCallback(async () => {
    if (!token) await authenticate();
    setPropsOpen(true);
  }, [token, authenticate]);

  const card = <MarketCardInner market={market} />;

  if (!isCreator) {
    return (
      <Link href={`/markets/${market.id}`} className="group block">
        {card}
      </Link>
    );
  }

  // Get current token (may have been set by authenticate() or cached)
  const currentToken = token ?? "";

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <Link href={`/markets/${market.id}`} className="group block">
            {card}
          </Link>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={handleEdit}>
            <Pencil className="h-4 w-4" />
            Edit
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleProperties}>
            <Info className="h-4 w-4" />
            Properties
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <EditMarketModal
        market={market}
        open={editOpen}
        onOpenChange={setEditOpen}
        token={currentToken}
        onSuccess={onMarketUpdated}
      />
      <MarketPropertiesModal
        marketId={market.id}
        marketTitle={market.title}
        open={propsOpen}
        onOpenChange={setPropsOpen}
        token={currentToken}
      />
    </>
  );
}

function MarketCardInner({ market }: { market: MarketSummary }) {
  const deadline = new Date(market.deadline);
  const label = deadlineLabel(deadline);
  const countdown = deadlineCountdown(deadline);

  // Liquidity: sum of all reserves (collateral locked in the AMM)
  const liquidity = market.reserves.reduce((sum, r) => sum + Number(r), 0);

  return (
    <Card className="relative h-full overflow-hidden py-0 gap-0 transition-all duration-300 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5">
      <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-gradient-to-br from-primary/[0.03] to-transparent" />

      <div className="relative flex flex-col gap-2 p-4">
        {/* Icon + Deadline label + countdown */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <MarketAssetIcon
              subject={market.subject}
              icon={market.icon}
              className="shrink-0 p-1.5"
              symbolClassName="text-[13px]"
              imageClassName="h-4 w-4"
            />
            <span className="text-sm font-semibold leading-snug transition-colors group-hover:text-primary">
              {label}
            </span>
          </div>
          {countdown ? (
            <div className="flex items-center gap-1.5 shrink-0 tabular-nums text-xs text-muted-foreground">
              {countdown.days > 0 && <TimeUnit value={countdown.days} label="days" />}
              <TimeUnit value={countdown.hours} label="hrs" />
              <TimeUnit value={countdown.minutes} label="mins" />
            </div>
          ) : (
            <span className="shrink-0 text-xs text-rose-400">Expired</span>
          )}
        </div>

        {/* Liquidity */}
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatUsdc(liquidity)} Liquidity
        </span>

        {/* Mini distribution chart — bleed to card edges */}
        <div className="-mx-4 -mb-4">
          <MiniChart market={market} height={90} showAxes />
        </div>
      </div>
    </Card>
  );
}

function TimeUnit({ value, label }: { value: number; label: string }) {
  return (
    <span className="flex items-baseline gap-0.5">
      <span className="text-sm font-semibold text-foreground tabular-nums">{String(value).padStart(2, "0")}</span>
      <span className="text-[10px]">{label}</span>
    </span>
  );
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function deadlineLabel(deadline: Date): string {
  const now = new Date();
  const diff = deadline.getTime() - now.getTime();
  if (diff <= 0) return "Expired";

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const deadlineDay = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate());
  const daysDiff = Math.floor((deadlineDay.getTime() - today.getTime()) / 86_400_000);

  if (daysDiff === 0) return "Today";
  if (daysDiff === 1) return "Tomorrow";
  // "Next Monday", "Next Friday", etc. (2-6 days away)
  if (daysDiff <= 6) return `Next ${DAY_NAMES[deadline.getDay()]}`;
  // Within same year: "Jan 06"
  const month = MONTH_NAMES[deadline.getMonth()];
  const day = String(deadline.getDate()).padStart(2, "0");
  if (deadline.getFullYear() === now.getFullYear()) return `${month} ${day}`;
  // Different year: "Jan 06, 2027"
  return `${month} ${day}, ${deadline.getFullYear()}`;
}

function deadlineCountdown(deadline: Date): { days: number; hours: number; minutes: number } | null {
  const diff = deadline.getTime() - Date.now();
  if (diff <= 0) return null;
  const totalMinutes = Math.floor(diff / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return { days, hours, minutes };
}
