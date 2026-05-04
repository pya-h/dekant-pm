"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { MarketSummary } from "@/lib/types";

export interface BookmarkStateResponse {
  bookmarked: boolean;
}

export function useMarketBookmark(
  marketId: string | undefined,
  walletAddress: string | undefined,
  token: string | null,
) {
  return useQuery({
    queryKey: ["marketBookmark", marketId, walletAddress],
    queryFn: () =>
      api.get<BookmarkStateResponse>(
        `/markets/${marketId}/bookmark`,
        undefined,
        token!,
      ),
    staleTime: 10_000,
    enabled: !!marketId && !!walletAddress && !!token,
  });
}

export function useBookmarkedMarkets(
  walletAddress: string | undefined,
  token: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: ["bookmarkedMarkets", walletAddress],
    queryFn: () =>
      api.get<MarketSummary[]>("/markets/bookmarks/me", undefined, token!),
    staleTime: 10_000,
    enabled: enabled && !!walletAddress && !!token,
  });
}
