"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { UserPosition } from "@/lib/types";

export function useUserPositions(address: string | undefined) {
  return useQuery({
    queryKey: ["userPositions", address],
    queryFn: () =>
      api.get<UserPosition[]>(`/users/${address}/positions`),
    staleTime: 10_000,
    enabled: !!address,
  });
}
