"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { formatUsdc, MarketType, MarketState, SCALE } from "@/lib/types";
import { Loader2, Copy, Check } from "lucide-react";

interface MarketProperties {
  market: {
    id: string;
    pubkey: string;
    marketType: number;
    state: number;
    title: string;
    description: string | null;
    category: string | null;
    subject: string;
    icon: string | null;
    tags: string[] | null;
    outcomeLabels: string[] | null;
    creator: string;
    oracle: string;
    collateralMint: string;
    deadline: string;
    createdAt: string;
    resolvedAt: string | null;
    numOutcomes: number;
    rangeMin: string | null;
    rangeMax: string | null;
    resolvedOutcome: number | null;
    resolvedValue: string | null;
  };
  stats: {
    totalTrades: number;
    totalPositions: number;
    totalLps: number;
    totalVolume: string;
    totalTraders: number;
    totalDeposited: string;
    protocolFeeAccumulated: string;
    lpFeeAccumulated: string;
    lpSharesTotal: string;
    lastTradeAt: string | null;
  };
}

interface MarketPropertiesModalProps {
  marketId: string;
  marketTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
}

const marketTypeLabel: Record<number, string> = {
  [MarketType.Binary]: "Binary",
  [MarketType.MultiOutcome]: "Multi-Outcome",
  [MarketType.Continuous]: "Continuous",
};

const marketStateLabel: Record<number, string> = {
  [MarketState.Active]: "Active",
  [MarketState.Paused]: "Paused",
  [MarketState.PendingResolution]: "Pending Resolution",
  [MarketState.Resolved]: "Resolved",
};

export function MarketPropertiesModal({
  marketId,
  marketTitle,
  open,
  onOpenChange,
  token,
}: MarketPropertiesModalProps) {
  const [data, setData] = useState<MarketProperties | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    api
      .get<MarketProperties>(`/markets/${marketId}/properties`, undefined, token)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [open, marketId, token]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Market Properties</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground truncate">
            {marketTitle}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {data && (
          <div className="grid gap-4 text-sm">
            {/* Addresses */}
            <Section title="Addresses">
              <CopyRow label="Market ID" value={data.market.id} />
              <CopyRow label="Market Address" value={data.market.pubkey} />
              <CopyRow label="Creator" value={data.market.creator} />
              <CopyRow label="Oracle" value={data.market.oracle} />
              <CopyRow label="Collateral Mint" value={data.market.collateralMint} />
            </Section>

            {/* Details */}
            <Section title="Details">
              <InfoRow label="Type" value={marketTypeLabel[data.market.marketType] ?? String(data.market.marketType)} />
              <InfoRow label="State">
                <Badge variant="outline" className="text-xs">
                  {marketStateLabel[data.market.state] ?? String(data.market.state)}
                </Badge>
              </InfoRow>
              <InfoRow label="Outcomes" value={String(data.market.numOutcomes)} />
              {data.market.rangeMin != null && (
                <InfoRow label="Range" value={`${Number(data.market.rangeMin) / SCALE} – ${Number(data.market.rangeMax) / SCALE}`} />
              )}
              <InfoRow label="Created" value={new Date(data.market.createdAt).toLocaleString()} />
              <InfoRow label="Deadline" value={new Date(data.market.deadline).toLocaleString()} />
              {data.market.resolvedAt && (
                <InfoRow label="Resolved At" value={new Date(data.market.resolvedAt).toLocaleString()} />
              )}
              {data.market.resolvedOutcome != null && (
                <InfoRow label="Resolved Outcome" value={String(data.market.resolvedOutcome)} />
              )}
              {data.market.resolvedValue != null && (
                <InfoRow label="Resolved Value" value={String(Number(data.market.resolvedValue) / SCALE)} />
              )}
            </Section>

            {/* Statistics */}
            <Section title="Statistics">
              <InfoRow label="Total Trades" value={String(data.stats.totalTrades)} />
              <InfoRow label="Unique Traders" value={String(data.stats.totalTraders)} />
              <InfoRow label="Total Volume" value={formatUsdc(data.stats.totalVolume)} />
              <InfoRow label="Position Holders" value={String(data.stats.totalPositions)} />
              <InfoRow label="LP Providers" value={String(data.stats.totalLps)} />
              <InfoRow label="Total Deposited" value={formatUsdc(data.stats.totalDeposited)} />
              <InfoRow label="Protocol Fees" value={formatUsdc(data.stats.protocolFeeAccumulated)} />
              <InfoRow label="LP Fees" value={formatUsdc(data.stats.lpFeeAccumulated)} />
              {data.stats.lastTradeAt && (
                <InfoRow label="Last Trade" value={new Date(data.stats.lastTradeAt).toLocaleString()} />
              )}
            </Section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        {title}
      </h4>
      <div className="grid gap-1.5">{children}</div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      {children ?? <span className="font-mono text-xs tabular-nums">{value}</span>}
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const truncated = value.length > 16 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;

  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <button
        type="button"
        onClick={copy}
        className="flex items-center gap-1.5 font-mono text-xs tabular-nums cursor-pointer hover:text-foreground transition-colors"
        title={value}
      >
        {truncated}
        {copied ? (
          <Check className="h-3 w-3 text-green-500" />
        ) : (
          <Copy className="h-3 w-3 text-muted-foreground" />
        )}
      </button>
    </div>
  );
}
