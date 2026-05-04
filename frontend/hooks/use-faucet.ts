"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface FaucetStatus {
  availableClaims: number;
}

export function useFaucetStatus(
  userAddress: string | undefined,
  tokenSymbol: string,
  enabled = true,
) {
  return useQuery({
    queryKey: ["faucet-status", userAddress, tokenSymbol],
    queryFn: () =>
      api.get<FaucetStatus>(`/faucet/status`, {
        address: userAddress,
        token: tokenSymbol,
      }),
    staleTime: 30_000,
    enabled: enabled && !!userAddress,
  });
}
