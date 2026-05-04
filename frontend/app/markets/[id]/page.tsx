"use client";

import { use, useState, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useMarket } from "@/hooks/use-market";
import { useUserMarketPosition } from "@/hooks/use-user-position";
import { useFaucetStatus } from "@/hooks/use-faucet";
import { MarketHeaderBar } from "@/components/market/market-header-bar";
import { PriceBar } from "@/components/market/price-bar";
import { RecentTrades } from "@/components/market/recent-trades";
import { MarketInfoSection } from "@/components/market/market-info-section";
import {
  MarketType,
  SCALE,
  computeProbabilities,
} from "@/lib/types";
import { TradingPanel } from "@/components/trading/trading-panel";
import { ContinuousTradingSection } from "@/components/trading/continuous-trading-section";
import { LiquidityPanel } from "@/components/liquidity/liquidity-panel";
import { sliderToSigma } from "@/lib/normal";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function MarketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: market, isLoading, error } = useMarket(id);

  const { publicKey } = useWallet();
  const walletAddress = publicKey?.toBase58();
  const { data: position } = useUserMarketPosition(walletAddress, id);
  const positionHoldings = useMemo(() => {
    if (!position) return null;
    const nums = position.holdings.map(Number);
    return nums.some((h) => h > 0) ? nums : null;
  }, [position]);

  const [mu, setMu] = useState<number | null>(null);
  const [sigma, setSigma] = useState<number | null>(null);
  const handleReset = useCallback(() => { setMu(null); setSigma(null); }, []);
  const chartRef = useRef<HTMLDivElement>(null);

  const { data: faucetData } = useFaucetStatus(walletAddress, "TOKEN");
  const faucetAvailable = faucetData?.availableClaims ?? 0;

  if (isLoading) return <MarketDetailSkeleton />;

  if (error || !market) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
          <h2 className="text-lg font-semibold">Market not found</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {error?.message ?? "This market does not exist or could not be loaded."}
          </p>
          <Button variant="outline" className="mt-4" asChild>
            <Link href="/markets">Back to Markets</Link>
          </Button>
        </div>
      </div>
    );
  }

  const isContinuous = market.marketType === MarketType.Continuous;
  const rangeMin = market.rangeMin != null ? Number(market.rangeMin) / SCALE : 0;
  const rangeMax = market.rangeMax != null ? Number(market.rangeMax) / SCALE : 100;
  const effectiveSigma = sigma ?? sliderToSigma(0.5, rangeMax - rangeMin);

  const probabilities = computeProbabilities(market.reserves, market.totalMinted, market.kSquared);
  const labels =
    market.outcomeLabels ??
    Array.from({ length: market.numOutcomes }, (_, i) => `Outcome ${i + 1}`);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      {/* ── Top section: title + countdown + stats + actions (full width) ── */}
      <MarketHeaderBar
        market={market}
        showFaucet={true}
        faucetAvailable={faucetAvailable}
        onClaimFaucet={() => toast.info("Faucet claim coming soon!")}
        chartRef={chartRef}
      />

      {/* ── 3-column layout: left panel | chart | right trading panel ── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[240px_1fr_280px]">
        {/* Left panel — Recent Trades */}
        <div className="hidden lg:block">
          <RecentTrades
            marketId={market.id}
            rangeMin={rangeMin}
            rangeMax={rangeMax}
          />
        </div>

        {/* Center — chart */}
        <div ref={chartRef} className="min-w-0">
          {isContinuous ? (
            <ContinuousTradingSection
              market={market}
              mu={mu}
              sigma={effectiveSigma}
              onMuChange={setMu}
              onSigmaChange={setSigma}
              positionHoldings={positionHoldings}
            />
          ) : (
            <Card>
              <CardHeader className="pb-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Probabilities
                </h2>
              </CardHeader>
              <CardContent>
                <ProbabilitySection
                  market={market}
                  probabilities={probabilities}
                  labels={labels}
                />
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right — trading panel */}
        <div className="space-y-4 lg:sticky lg:top-16 lg:self-start">
          <TradingPanel
            market={market}
            distributionParams={isContinuous ? { mu, sigma: effectiveSigma, onReset: handleReset } : undefined}
          />
          <div className="flex items-center justify-between rounded-lg border border-border/30 bg-muted/10 px-3 py-2.5">
            <div>
              <div className="text-xs font-medium">Liquidity Provision</div>
              <div className="text-[10px] text-muted-foreground">
                Earn fees by providing liquidity
              </div>
            </div>
            <LiquidityPanel market={market} />
          </div>
        </div>
      </div>

      {/* ── Below fold: Market Context / Rules / Timeline & Payout ── */}
      <div className="mt-6">
        <MarketInfoSection market={market} />
      </div>
    </div>
  );
}

function ProbabilitySection({
  market,
  probabilities,
  labels,
}: {
  market: { marketType: MarketType };
  probabilities: number[];
  labels: string[];
}) {
  if (probabilities.length === 0) {
    return <p className="text-sm text-muted-foreground">No data available.</p>;
  }
  return (
    <PriceBar
      probabilities={probabilities}
      labels={labels}
      variant={market.marketType === MarketType.Binary ? "binary" : "multi"}
    />
  );
}

function MarketDetailSkeleton() {
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      {/* Top bar skeleton */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 animate-pulse rounded-lg bg-muted" />
            <div className="h-6 w-64 animate-pulse rounded bg-muted" />
          </div>
          <div className="flex items-center gap-3">
            <div className="h-14 w-36 animate-pulse rounded-lg bg-muted" />
            <div className="h-10 w-28 animate-pulse rounded-lg bg-muted" />
          </div>
        </div>
        <div className="flex gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 w-32 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>

      {/* 3-column skeleton */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[240px_1fr_280px]">
        <div className="hidden lg:block">
          <div className="h-[500px] animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="h-[500px] animate-pulse rounded-lg bg-muted" />
        <div className="h-[400px] animate-pulse rounded-lg bg-muted" />
      </div>
    </div>
  );
}
