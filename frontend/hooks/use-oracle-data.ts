"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface OracleData {
  distributionPeak: number | null;
  mostLikelyRange: [number, number] | null;
  confidence95: [number, number] | null;
}

export function useOracleData(marketId: string, enabled = true) {
  return useQuery({
    queryKey: ["oracle-data", marketId],
    queryFn: () => api.get<OracleData>(`/markets/${marketId}/oracle-data`),
    staleTime: 60_000,
    enabled: enabled && !!marketId,
  });
}
