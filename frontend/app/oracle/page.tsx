"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useAdminRole } from "@/hooks/use-admin-role";
import { useMarkets } from "@/hooks/use-markets";
import { MarketState, MarketType, SCALE } from "@/lib/types";
import { ResolveForm } from "@/components/oracle/resolve-form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Wallet,
  ShieldAlert,
  Loader2,
  Eye,
  CheckCircle2,
  Clock,
} from "lucide-react";

const TYPE_LABELS: Record<MarketType, string> = {
  [MarketType.Binary]: "Binary",
  [MarketType.MultiOutcome]: "Multi",
  [MarketType.Continuous]: "Continuous",
};

export default function OraclePage() {
  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const { isOracle, isSuperadmin, isLoading: roleLoading } = useAdminRole();

  const oracleAddress = publicKey?.toBase58();

  // Fetch markets assigned to this oracle in PendingResolution state
  const {
    data: pendingData,
    isLoading: pendingLoading,
    error: pendingError,
  } = useMarkets({
    oracle: oracleAddress,
    state: MarketState.PendingResolution,
    limit: 100,
  });

  // Also fetch recently resolved markets by this oracle for reference
  const { data: resolvedData, isLoading: resolvedLoading } = useMarkets({
    oracle: oracleAddress,
    state: MarketState.Resolved,
    limit: 10,
    sortBy: "newest",
  });

  // Not connected
  if (!connected) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-6 text-center">
          <div className="rounded-full bg-muted p-4">
            <Wallet className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Connect your wallet</h1>
            <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
              Connect a wallet with Oracle role to access the resolution
              dashboard.
            </p>
          </div>
          <Button
            size="lg"
            onClick={() => setVisible(true)}
            className="gap-2"
          >
            <Wallet className="h-4 w-4" />
            Connect Wallet
          </Button>
        </div>
      </div>
    );
  }

  // Checking role
  if (roleLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Checking permissions...
          </p>
        </div>
      </div>
    );
  }

  // Not authorized (must be oracle or superadmin)
  if (!isOracle && !isSuperadmin) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-6 text-center">
          <div className="rounded-full bg-destructive/10 p-4">
            <ShieldAlert className="h-8 w-8 text-destructive" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Access Denied</h1>
            <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
              Your connected wallet does not have Oracle privileges. Contact
              the protocol admin to get the Oracle role assigned.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const pendingMarkets = pendingData?.data ?? [];
  const resolvedMarkets = resolvedData?.data ?? [];
  const isLoadingMarkets = pendingLoading || resolvedLoading;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Eye className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Oracle Dashboard
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Resolve markets that have passed their deadline
          </p>
        </div>
      </div>

      {/* Error state */}
      {pendingError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Failed to load markets: {pendingError.message}
        </div>
      )}

      {/* Loading state */}
      {isLoadingMarkets && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading markets...
        </div>
      )}

      {/* Pending Resolution section */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-amber-500" />
          <h2 className="text-lg font-semibold">
            Pending Resolution
          </h2>
          {!isLoadingMarkets && (
            <Badge variant="secondary" className="ml-1">
              {pendingMarkets.length}
            </Badge>
          )}
        </div>

        {!isLoadingMarkets && pendingMarkets.length === 0 && (
          <div className="rounded-lg border border-border/50 bg-muted/30 px-6 py-10 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">
              No markets awaiting resolution. Markets assigned to you will
              appear here once their deadline passes.
            </p>
          </div>
        )}

        <div className="space-y-4">
          {pendingMarkets.map((market) => (
            <div
              key={market.id}
              className="rounded-lg border border-border/50 bg-card"
            >
              {/* Market header */}
              <div className="flex items-start justify-between gap-4 border-b border-border/30 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-base font-semibold">
                      {market.title}
                    </h3>
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {TYPE_LABELS[market.marketType]}
                    </Badge>
                  </div>
                  {market.description && (
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {market.description}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      Deadline:{" "}
                      {new Date(market.deadline).toLocaleDateString()}
                    </span>
                    <span>Outcomes: {market.numOutcomes}</span>
                    {market.marketType === MarketType.Continuous &&
                      market.rangeMin !== null &&
                      market.rangeMax !== null && (
                        <span>
                          Range: {Number(market.rangeMin) / SCALE} &ndash;{" "}
                          {Number(market.rangeMax) / SCALE}
                        </span>
                      )}
                  </div>
                </div>
              </div>

              {/* Resolve form */}
              <div className="px-5 py-4">
                <ResolveForm market={market} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Recently Resolved section */}
      {resolvedMarkets.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-500" />
            <h2 className="text-lg font-semibold">Recently Resolved</h2>
          </div>

          <div className="space-y-2">
            {resolvedMarkets.map((market) => (
              <div
                key={market.id}
                className="flex items-center justify-between rounded-lg border border-border/30 bg-card/50 px-5 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {market.title}
                    </span>
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {TYPE_LABELS[market.marketType]}
                    </Badge>
                  </div>
                </div>
                <div className="ml-4 shrink-0 text-right text-sm">
                  {market.marketType === MarketType.Continuous &&
                  market.resolvedValue !== null ? (
                    <span className="font-mono text-green-400">
                      Value: {Number(market.resolvedValue) / SCALE}
                    </span>
                  ) : market.resolvedOutcome !== null ? (
                    <span className="font-mono text-green-400">
                      Outcome:{" "}
                      {market.outcomeLabels?.[market.resolvedOutcome] ??
                        `#${market.resolvedOutcome}`}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Resolved</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
