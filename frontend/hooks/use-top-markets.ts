"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { MarketSummary, PaginatedResponse } from "@/lib/types";

const TOP_MARKETS_COUNT = 5;

export function useTopMarkets() {
  return useQuery({
    queryKey: ["top-markets", TOP_MARKETS_COUNT],
    queryFn: () =>
      api.get<PaginatedResponse<MarketSummary>>("/markets", {
        page: 1,
        limit: TOP_MARKETS_COUNT,
        sortBy: "volume",
      }),
    staleTime: 30_000,
  });
}
