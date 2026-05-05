"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTopMarkets } from "@/hooks/use-top-markets";
import { useAuth } from "@/hooks/use-auth";
import { useMarketBookmark } from "@/hooks/use-bookmarks";
import { DistributionChart } from "@/components/market/distribution-chart";
import { PriceBar } from "@/components/market/price-bar";
import { MarketHeaderBar } from "@/components/market/market-header-bar";
import {
  MarketType,
  MarketState,
  SCALE,
  computeProbabilities,
  type MarketSummary,
} from "@/lib/types";
import { api } from "@/lib/api";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function MarketSlideshow() {
  const { data, isLoading } = useTopMarkets();
  const [currentIndex, setCurrentIndex] = useState(0);

  const markets = data?.data ?? [];

  // Clamp index if markets list shrank after a refetch
  const safeIndex = markets.length > 0 ? Math.min(currentIndex, markets.length - 1) : 0;

  const prev = useCallback(() => {
    setCurrentIndex((i) => (i === 0 ? markets.length - 1 : i - 1));
  }, [markets.length]);

  const next = useCallback(() => {
    setCurrentIndex((i) => (i === markets.length - 1 ? 0 : i + 1));
  }, [markets.length]);

  // Auto-advance every 8 seconds, reset timer on manual navigation
  const timerRef = useRef<ReturnType<typeof setInterval>>(null);

  useEffect(() => {
    if (markets.length <= 1) return;
    timerRef.current = setInterval(() => {
      setCurrentIndex((i) => (i >= markets.length - 1 ? 0 : i + 1));
    }, 8000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [markets.length, currentIndex]);

  if (isLoading) {
    return <SlideshowSkeleton />;
  }

  if (markets.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-border/40 bg-muted/10 p-12">
        <p className="text-sm text-muted-foreground">No markets available</p>
      </div>
    );
  }

  const market = markets[safeIndex];

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-xl">
        <div
          key={safeIndex}
          className="animate-slide-in"
        >
          <SlideContent market={market} />
        </div>
      </div>

      {/* Navigation */}
      {markets.length > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={prev}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-1.5">
            {markets.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentIndex(i)}
                className={`h-2 rounded-full transition-all ${
                  i === safeIndex
                    ? "w-6 bg-primary"
                    : "w-2 bg-muted-foreground/30 hover:bg-muted-foreground/50"
                }`}
              />
            ))}
          </div>
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={next}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function SlideContent({ market }: { market: MarketSummary }) {
  const probabilities = computeProbabilities(market.reserves, market.totalMinted, market.kSquared);
  const labels =
    market.outcomeLabels ??
    Array.from({ length: market.numOutcomes }, (_, i) => `Outcome ${i + 1}`);

  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const walletAddress = publicKey?.toBase58();
  const { token, authenticate, isAuthenticating } = useAuth();
  const queryClient = useQueryClient();

  const { data: bookmarkState, isLoading: bookmarkStateLoading } = useMarketBookmark(
    market.id,
    walletAddress,
    token,
  );
  const isBookmarked = bookmarkState?.bookmarked ?? false;

  const toggleBookmarkMutation = useMutation({
    mutationFn: async (nextBookmarked: boolean) => {
      if (!connected || !walletAddress) throw new Error("Wallet not connected");
      let authToken = token;
      if (!authToken) authToken = await authenticate();
      if (nextBookmarked) {
        return api.post<{ bookmarked: boolean }>(`/markets/${market.id}/bookmark`, {}, authToken);
      }
      return api.delete<{ bookmarked: boolean }>(`/markets/${market.id}/bookmark`, authToken);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["marketBookmark", market.id, walletAddress] });
      queryClient.invalidateQueries({ queryKey: ["bookmarkedMarkets", walletAddress] });
    },
  });

  const handleToggleBookmark = useCallback(async () => {
    if (!connected) { setVisible(true); return; }
    try {
      await toggleBookmarkMutation.mutateAsync(!isBookmarked);
      toast.success(!isBookmarked ? "Market bookmarked" : "Bookmark removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bookmark action failed");
    }
  }, [connected, isBookmarked, setVisible, toggleBookmarkMutation]);

  return (
    <div className="rounded-xl border border-border/40 bg-card/50 p-5">
      {/* Stats + countdown + action buttons — same as market detail, without faucet */}
      <div className="mb-4">
        <MarketHeaderBar
          market={market}
          isBookmarked={isBookmarked}
          bookmarkLoading={bookmarkStateLoading || toggleBookmarkMutation.isPending || isAuthenticating}
          onToggleBookmark={handleToggleBookmark}
          bookmarkDisabled={toggleBookmarkMutation.isPending}
        />
      </div>

      {/* Chart — clickable to market detail */}
      <Link href={`/markets/${market.id}`} className="block rounded-lg hover:ring-1 hover:ring-primary/30 transition-all">
        <SlideChart
          market={market}
          probabilities={probabilities}
          labels={labels}
        />
      </Link>
    </div>
  );
}

function SlideChart({
  market,
  probabilities,
  labels,
}: {
  market: MarketSummary;
  probabilities: number[];
  labels: string[];
}) {
  if (probabilities.length === 0) {
    return <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">No data</div>;
  }

  if (market.marketType === MarketType.Continuous) {
    const rMin = market.rangeMin != null ? Number(market.rangeMin) / SCALE : 0;
    const rMax = market.rangeMax != null ? Number(market.rangeMax) / SCALE : 100;
    const resolved =
      market.state === MarketState.Resolved && market.resolvedValue != null
        ? Number(market.resolvedValue) / SCALE
        : null;

    return (
      <DistributionChart
        probabilities={probabilities}
        rangeMin={rMin}
        rangeMax={rMax}
        numBins={market.numOutcomes}
        resolvedValue={resolved}
        height={200}
      />
    );
  }

  return (
    <div className="py-4">
      <PriceBar
        probabilities={probabilities}
        labels={labels}
        variant={market.marketType === MarketType.Binary ? "binary" : "multi"}
      />
    </div>
  );
}

function SlideshowSkeleton() {
  return (
    <div className="rounded-xl border border-border/40 bg-card/50 p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-10 w-10 animate-pulse rounded-lg bg-muted" />
        <div className="h-6 w-64 animate-pulse rounded bg-muted" />
      </div>
      <div className="flex gap-2 mb-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-14 w-28 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
      <div className="h-48 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}
