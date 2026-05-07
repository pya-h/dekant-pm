"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface TokenPrice {
  token_id: string;
  price: number;
  ema_price: number;
  confidence: number;
  timestamp: string;
  stale?: boolean;
}

export interface MarketPriceResult {
  marketId: string;
  subject: string;
  price: TokenPrice;
}

export function useLivePrice(marketId: string, category: string | null) {
  return useQuery({
    queryKey: ["live-price", marketId],
    queryFn: () => api.get<MarketPriceResult>(`/prices/market/${marketId}`),
    enabled: category === "crypto",
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
