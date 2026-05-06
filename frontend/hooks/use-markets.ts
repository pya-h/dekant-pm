"use client";

import {
  useQuery,
  keepPreviousData,
  useInfiniteQuery,
} from "@tanstack/react-query";
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

export function useAllMarkets(enabled = true) {
  return useQuery({
    queryKey: ["marketsAll"],
    queryFn: async () => {
      const pages: MarketSummary[] = [];
      let page = 1;
      const limit = 100;
      while (true) {
        const res = await api.get<PaginatedResponse<MarketSummary>>("/markets", { page, limit });
        pages.push(...res.data);
        if (pages.length >= res.total) break;
        page++;
      }
      return pages;
    },
    staleTime: 15_000,
    enabled,
  });
}

interface UseInfiniteMarketsParams extends MarketFilters {
  limit?: number;
  enabled?: boolean;
  includeStats?: boolean;
}

export function useInfiniteMarkets(params: UseInfiniteMarketsParams = {}) {
  const { limit = 16, enabled = true, ...filters } = params;

  return useInfiniteQuery({
    queryKey: ["marketsInfinite", { limit, ...filters }],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.get<PaginatedResponse<MarketSummary>>("/markets", {
        page: pageParam,
        limit,
        ...filters,
      }),
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.reduce((sum, page) => sum + page.data.length, 0);
      return loadedCount < lastPage.total ? allPages.length + 1 : undefined;
    },
    staleTime: 15_000,
    enabled,
  });
}
