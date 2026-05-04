"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { UserPosition, LpPosition, Trade } from "@/lib/types";

export function useUserPositions(address: string | undefined) {
  return useQuery({
    queryKey: ["userPositions", address],
    queryFn: () =>
      api.get<UserPosition[]>(`/users/${address}/positions`),
    staleTime: 10_000,
    enabled: !!address,
  });
}

export function useLpPositions(address: string | undefined) {
  return useQuery({
    queryKey: ["lpPositions", address],
    queryFn: () =>
      api.get<LpPosition[]>(`/users/${address}/lp-positions`),
    staleTime: 10_000,
    enabled: !!address,
  });
}

export function useUserTrades(address: string | undefined) {
  return useQuery({
    queryKey: ["userTrades", address],
    queryFn: () =>
      api.get<{ data: Trade[]; total: number }>(
        `/users/${address}/history`,
        { limit: 100 },
      ),
    staleTime: 15_000,
    enabled: !!address,
  });
}
