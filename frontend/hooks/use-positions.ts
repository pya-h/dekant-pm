"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { UserPosition, LpPosition } from "@/lib/types";

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
