"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronDown } from "lucide-react";
import { MarketState, type MarketDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

interface MarketInfoSectionProps {
  market: MarketDetail;
}

export function MarketInfoSection({ market }: MarketInfoSectionProps) {
  return (
    <Card className="overflow-hidden border-border/40 bg-card/35 backdrop-blur-sm">
      <CardContent className="divide-y divide-border/25 p-0">
        <CollapsibleSection title="Market Context" defaultOpen>
          <MarketContext description={market.description} />
        </CollapsibleSection>
        <CollapsibleSection title="Rules">
          <MarketRules />
        </CollapsibleSection>
        <CollapsibleSection title="Timeline and Payout">
          <TimelineAndPayout market={market} />
        </CollapsibleSection>
      </CardContent>
    </Card>
  );
}

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={cn("transition-colors", open && "bg-muted/[0.06]")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-muted/10"
      >
        <span className="text-sm font-semibold tracking-tight">{title}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground/90 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}

function MarketContext({ description }: { description: string | null }) {
  if (!description) {
    return (
      <p className="text-sm text-muted-foreground">
        No description available for this market.
      </p>
    );
  }
  return (
    <p className="text-sm leading-relaxed text-muted-foreground/95">
      {description}
    </p>
  );
}

function MarketRules() {
  return (
    <ul className="space-y-2 text-sm leading-relaxed text-muted-foreground">
      <li>
        <strong className="text-foreground">Market resolution:</strong> The market
        resolves after deadline by the designated oracle using real-world data.
      </li>
      <li>
        <strong className="text-foreground">Trading:</strong> Buy or sell while
        the market is active. Prices update continuously using the AMM curve.
      </li>
      <li>
        <strong className="text-foreground">Fees:</strong> Trade fees are
        deducted automatically and split between protocol and LPs.
      </li>
      <li>
        <strong className="text-foreground">Payouts:</strong> After resolution,
        each winning token is redeemable 1:1 for collateral (minus redemption
        fee if configured).
      </li>
      <li>
        <strong className="text-foreground">Liquidity:</strong> LPs can add or
        remove liquidity during active markets and earn fee share.
      </li>
      <li>
        <strong className="text-foreground">Finality:</strong> Executed trades
        are on-chain and final.
      </li>
    </ul>
  );
}

function TimelineAndPayout({ market }: { market: MarketDetail }) {
  const createdAt = new Date(market.createdAt);
  const deadline = new Date(market.deadline);
  const resolvedAt = market.resolvedAt ? new Date(market.resolvedAt) : null;
  const now = new Date();

  const isExpired = deadline.getTime() < now.getTime();
  const isResolved = market.state === MarketState.Resolved;

  // Timeline stages
  const stages: { label: string; date: Date | null; status: "done" | "active" | "future" }[] = [
    {
      label: "Market Created",
      date: createdAt,
      status: "done",
    },
    {
      label: "Trading Active",
      date: null,
      status:
        !isExpired && market.state === MarketState.Active
          ? "active"
          : isExpired || isResolved
            ? "done"
            : market.state === MarketState.Paused
              ? "active"
              : "done",
    },
    {
      label: "Deadline Reached",
      date: deadline,
      status: isExpired ? "done" : "future",
    },
    {
      label: "Resolution",
      date: resolvedAt,
      status: isResolved ? "done" : isExpired ? "active" : "future",
    },
    {
      label: "Payout & Claims",
      date: null,
      status: isResolved ? "active" : "future",
    },
  ];

  return (
    <div className="space-y-5">
      {/* Timeline */}
      <div>
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Timeline
        </h4>
        <div className="relative space-y-0">
          {stages.map((stage, i) => (
            <div key={stage.label} className="flex gap-3">
              {/* Vertical line + dot */}
              <div className="relative flex flex-col items-center">
                <div
                  className={cn(
                    "h-3 w-3 rounded-full border-2 shrink-0 z-10",
                    stage.status === "done" &&
                      "border-emerald-500 bg-emerald-500",
                    stage.status === "active" &&
                      "border-amber-400 bg-amber-400 animate-pulse",
                    stage.status === "future" &&
                      "border-muted-foreground/30 bg-transparent",
                  )}
                />
                {i < stages.length - 1 && (
                  <div
                    className={cn(
                      "w-px flex-1 min-h-[24px]",
                      stage.status === "done"
                        ? "bg-emerald-500/40"
                        : "bg-border/30",
                    )}
                  />
                )}
              </div>
              {/* Content */}
              <div className="pb-3 -mt-0.5">
                <span
                  className={cn(
                    "text-sm",
                    stage.status === "active"
                      ? "font-medium text-foreground"
                      : stage.status === "done"
                        ? "text-muted-foreground"
                        : "text-muted-foreground/50",
                  )}
                >
                  {stage.label}
                </span>
                {stage.date && (
                  <span className="ml-2 text-[11px] text-muted-foreground/60">
                    {stage.date.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Payout info */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Payout
        </h4>
        <p className="text-sm leading-relaxed text-muted-foreground">
          After oracle resolution, winning outcome token holders can claim
          payout on-chain. Each winning token is redeemable 1:1 for collateral
          (minus redemption fee if configured). Losing outcome tokens are not
          redeemable.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          For continuous markets, the resolved value determines which bin wins.
          Only tokens in the winning bin are redeemable.
        </p>
      </div>
    </div>
  );
}
