"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { UserPosition } from "@/lib/types";

/**
 * Fetches a single user position for a specific market.
 * Returns null if the user has no position.
 */
export function useUserMarketPosition(
  address: string | undefined,
  marketId: string | undefined,
) {
  return useQuery({
    queryKey: ["userPosition", address, marketId],
    queryFn: () =>
      api.get<UserPosition | null>(
        `/users/${address}/market-position/${marketId}`,
      ),
    staleTime: 10_000,
    enabled: !!address && !!marketId,
  });
}
