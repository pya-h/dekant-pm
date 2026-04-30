"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { MarketSummary, PaginatedResponse, MarketFilters } from "@/lib/types";

interface UseMarketsParams extends MarketFilters {
  page?: number;
  limit?: number;
  enabled?: boolean;
  includeStats?: boolean;
}

export function useMarkets(params: UseMarketsParams = {}) {
  const { page = 1, limit = 20, enabled = true, ...filters } = params;

  return useQuery({
    queryKey: ["markets", { page, limit, ...filters }],
    queryFn: () =>
      api.get<PaginatedResponse<MarketSummary>>("/markets", {
        page,
        limit,
        ...filters,
      }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    enabled,
  });
}
