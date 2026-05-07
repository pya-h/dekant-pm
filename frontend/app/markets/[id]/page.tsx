"use client";

import { use, useState, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMarket } from "@/hooks/use-market";
import { useUserMarketPosition } from "@/hooks/use-user-position";
import { useFaucetStatus, useClaimFaucet } from "@/hooks/use-faucet";
import { useAuth } from "@/hooks/use-auth";
import { useMarketBookmark } from "@/hooks/use-bookmarks";
import { MarketHeaderBar } from "@/components/market/market-header-bar";
import { PriceBar } from "@/components/market/price-bar";
import { RecentTrades } from "@/components/market/recent-trades";
import { MarketInfoSection } from "@/components/market/market-info-section";
import { CommentsSection } from "@/components/market/comments-section";
import { RelatedMarketsRow } from "@/components/market/related-markets-row";
import {
  MarketType,
  SCALE,
  computeProbabilities,
} from "@/lib/types";
import { TradingPanel } from "@/components/trading/trading-panel";
import { ContinuousTradingSection } from "@/components/trading/continuous-trading-section";
import { sliderToSigma } from "@/lib/normal";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useTutorial, TUTORIAL_TOTAL_STEPS } from "@/hooks/use-tutorial";
import { TutorialOverlay, type TutorialStep } from "@/components/common/tutorial-overlay";

const TUTORIAL_STEPS: TutorialStep[] = [
  { target: "claim-tokens", title: "Claim initial tokens", placement: "bottom" },
  { target: "chart", title: "Select first range on chart", placement: "left" },
  { target: "chart", title: "Select second range on chart", placement: "right" },
  { target: "chart", title: "Adjust confidence", placement: "right" },
  { target: "open-position", title: "Place position from here", placement: "top" },
];

export default function MarketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: market, isLoading, error } = useMarket(id);

  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const queryClient = useQueryClient();
  const walletAddress = publicKey?.toBase58();
  const { token, authenticate, isAuthenticating } = useAuth();
  const { data: position } = useUserMarketPosition(walletAddress, id);
  const tutorial = useTutorial(token);
  const { data: bookmarkState, isLoading: bookmarkStateLoading } = useMarketBookmark(
    id,
    walletAddress,
    token,
  );
  const positionHoldings = useMemo(() => {
    if (!position) return null;
    const nums = position.holdings.map(Number);
    return nums.some((h) => h > 0) ? nums : null;
  }, [position]);

  const [mu, setMu] = useState<number | null>(null);
  const [sigma, setSigma] = useState<number | null>(null);
  const handleReset = useCallback(() => { setMu(null); setSigma(null); }, []);
  const chartRef = useRef<HTMLDivElement>(null);

  const collateralMint = market?.collateralMint ?? "";
  const { data: faucetData } = useFaucetStatus(walletAddress, collateralMint, !!collateralMint);
  const faucetAvailable = faucetData?.remainingClaims ?? 0;
  const claimFaucet = useClaimFaucet(walletAddress);
  const isBookmarked = bookmarkState?.bookmarked ?? false;

  // Auth is triggered lazily (on bookmark click), not on page load.
  // This avoids forcing admins to sign on every market detail visit.

  const toggleBookmarkMutation = useMutation({
    mutationFn: async (nextBookmarked: boolean) => {
      if (!connected || !walletAddress) {
        throw new Error("Wallet is not connected");
      }

      let authToken = token;
      if (!authToken) {
        authToken = await authenticate();
      }

      if (nextBookmarked) {
        return api.post<{ bookmarked: boolean }>(
          `/markets/${id}/bookmark`,
          {},
          authToken,
        );
      }
      return api.delete<{ bookmarked: boolean }>(
        `/markets/${id}/bookmark`,
        authToken,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["marketBookmark", id, walletAddress] });
      queryClient.invalidateQueries({ queryKey: ["bookmarkedMarkets", walletAddress] });
    },
  });

  const handleToggleBookmark = useCallback(async () => {
    if (!connected) {
      setVisible(true);
      return;
    }

    const nextBookmarked = !isBookmarked;
    try {
      await toggleBookmarkMutation.mutateAsync(nextBookmarked);
      toast.success(nextBookmarked ? "Market bookmarked" : "Bookmark removed");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Bookmark action failed";
      toast.error(msg);
    }
  }, [connected, isBookmarked, setVisible, toggleBookmarkMutation]);

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
    <div className="mx-auto max-w-[1800px] px-3 py-4 sm:px-4">
      {/* ── Top section: title + countdown + stats + actions (full width) ── */}
      <MarketHeaderBar
        market={market}
        showFaucet={true}
        faucetAvailable={faucetAvailable}
        faucetLoading={claimFaucet.isPending}
        onClaimFaucet={async () => {
          if (!connected) { setVisible(true); return; }
          let authToken = token;
          if (!authToken) authToken = await authenticate();
          claimFaucet.mutate({ token: collateralMint, authToken });
        }}
        chartRef={chartRef}
        isBookmarked={isBookmarked}
        bookmarkLoading={bookmarkStateLoading || toggleBookmarkMutation.isPending || isAuthenticating}
        onToggleBookmark={handleToggleBookmark}
        bookmarkDisabled={toggleBookmarkMutation.isPending}
      />

      {/* ── 3-column layout: left panel | chart | right trading panel ── */}
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[300px_1fr_340px] xl:grid-cols-[320px_1fr_360px]">
        {/* Left panel — Recent Trades */}
        <div className="hidden lg:block">
          <RecentTrades
            marketId={market.id}
            rangeMin={rangeMin}
            rangeMax={rangeMax}
          />
        </div>

        {/* Center — chart + info sections */}
        <div className="min-w-0 space-y-5">
          <div ref={chartRef}>
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

          {/* Market Context / Rules / Timeline & Payout — below chart, same width */}
          <MarketInfoSection market={market} />
        </div>

        {/* Right — trading panel */}
        <div className="lg:sticky lg:top-16 lg:self-start">
          <TradingPanel
            market={market}
            distributionParams={isContinuous ? { mu, sigma: effectiveSigma, onReset: handleReset } : undefined}
          />
        </div>
      </div>

      {/* ── Comments & Activity ── */}
      <div className="mt-6">
        <CommentsSection marketId={market.id} marketCreator={market.creator} />
      </div>

      {/* ── Related markets by same subject/asset ── */}
      <div className="mt-8">
        <RelatedMarketsRow market={market} />
      </div>

      {/* ── Tutorial overlay for continuous markets ── */}
      {isContinuous && tutorial.isActive && tutorial.currentStep !== null && (
        <TutorialOverlay
          steps={TUTORIAL_STEPS}
          currentStep={tutorial.currentStep}
          onAdvance={tutorial.advance}
          onGoBack={tutorial.goBack}
          onDismiss={tutorial.dismiss}
        />
      )}
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
    <div className="mx-auto max-w-[1800px] px-3 py-4 sm:px-4">
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
      <div className="mt-4 grid gap-4 lg:grid-cols-[300px_1fr_340px] xl:grid-cols-[320px_1fr_360px]">
        <div className="hidden lg:block">
          <div className="h-[500px] animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="h-[500px] animate-pulse rounded-lg bg-muted" />
        <div className="h-[500px] animate-pulse rounded-lg bg-muted" />
      </div>
    </div>
  );
}
