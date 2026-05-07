"use client";

import Link from "next/link";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { MarketStatus } from "@/components/market/market-status";
import { MarketTypeBadge } from "@/components/market/market-type-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  MarketState,
  USDC_DECIMALS,
  formatUsdc,
  type LpPosition,
} from "@/lib/types";

interface LpPositionCardProps {
  position: LpPosition;
}

export function LpPositionCard({ position }: LpPositionCardProps) {
  const { market } = position;
  const shares = BigInt(position.shares);
  const deposited = Number(position.depositedCollateral);
  const hasShares = shares > BigInt(0);

  return (
    <Card className="relative h-full overflow-hidden transition-all duration-300 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5">
      <CardHeader className="relative space-y-3 pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <MarketTypeBadge type={market.marketType} />
            <MarketStatus state={market.state} />
          </div>
          <Badge
            variant="outline"
            className="text-[11px] border-violet-500/30 bg-violet-500/10 text-violet-400"
          >
            LP
          </Badge>
        </div>

        <Link
          href={`/markets/${market.id}`}
          className="line-clamp-2 text-sm font-semibold leading-snug transition-colors hover:text-primary"
        >
          {market.title}
        </Link>
      </CardHeader>

      <CardContent className="relative space-y-2 pb-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Shares</span>
          <span className="tabular-nums font-medium">
            {formatLpShares(shares)}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Deposited</span>
          <span className="tabular-nums">{formatUsdc(deposited)}</span>
        </div>
      </CardContent>

      <CardFooter className="relative justify-between border-t border-border/40 pt-3 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {hasShares ? "Active" : "Withdrawn"}
        </span>
        {hasShares ? (
          <Button variant="outline" size="sm" className="h-6 text-[11px] px-2" asChild>
            <Link href={`/markets/${market.id}`}>Manage</Link>
          </Button>
        ) : market.state === MarketState.Active ? (
          <span className="tabular-nums">
            Vol {formatUsdc(market.totalVolume)}
          </span>
        ) : null}
      </CardFooter>
    </Card>
  );
}

function formatLpShares(raw: bigint): string {
  const divisor = BigInt(10 ** USDC_DECIMALS);
  const whole = raw / divisor;
  const frac = Number(raw % divisor) / Number(divisor);
  const n = Number(whole) + frac;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(2);
}
