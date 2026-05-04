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
    <Card>
      <CardContent className="divide-y divide-border/30 p-0">
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
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-3.5 text-left transition-colors hover:bg-muted/10"
      >
        <span className="text-sm font-semibold">{title}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && <div className="px-5 pb-4">{children}</div>}
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
    <p className="text-sm leading-relaxed text-muted-foreground">
      {description}
    </p>
  );
}

function MarketRules() {
  return (
    <ul className="space-y-2 text-sm leading-relaxed text-muted-foreground">
      <li>
        <strong className="text-foreground">Market resolution:</strong> The
        market will be resolved by the designated oracle after the deadline. The
        oracle determines the final outcome based on real-world data.
      </li>
      <li>
        <strong className="text-foreground">Trading:</strong> You can buy and
        sell positions at any time while the market is active. Prices are
        determined by an automated market maker (AMM) based on current demand.
      </li>
      <li>
        <strong className="text-foreground">Fees:</strong> A small fee is
        charged on each trade, split between the protocol and liquidity
        providers. Fees are deducted from the trade amount automatically.
      </li>
      <li>
        <strong className="text-foreground">Payouts:</strong> After resolution,
        holders of the winning outcome tokens can claim their payout. Each
        winning token is redeemable for collateral proportional to the total
        pool.
      </li>
      <li>
        <strong className="text-foreground">Liquidity provision:</strong> You
        can provide liquidity to earn a share of trading fees. LP positions can
        be added or removed while the market is active.
      </li>
      <li>
        <strong className="text-foreground">No refunds:</strong> All trades are
        final and executed on-chain. There are no refunds or reversals once a
        transaction is confirmed.
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
          After the market is resolved by the oracle, winning outcome token
          holders can claim their payout. Each winning token entitles the holder
          to a proportional share of the total collateral pool. Losing outcome
          tokens become worthless. Payouts are processed on-chain and can be
          claimed at any time after resolution — there is no expiry on claims.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          For continuous markets, the resolved value determines which bin wins.
          Only tokens in the winning bin are redeemable. The payout per winning
          token equals the total collateral divided by the number of winning
          tokens in circulation.
        </p>
      </div>
    </div>
  );
}
