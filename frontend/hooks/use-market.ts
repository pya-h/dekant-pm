"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { MarketDetail } from "@/lib/types";

export function useMarket(id: string) {
  return useQuery({
    queryKey: ["market", id],
    queryFn: () => api.get<MarketDetail>(`/markets/${id}`),
    staleTime: 10_000,
    enabled: !!id,
  });
}
