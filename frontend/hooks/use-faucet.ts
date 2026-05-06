"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface FaucetSingleStatus {
  available: boolean;
  remainingClaims: number;
  amountPerRequest: string;
  label: string;
}

interface ClaimResult {
  txSignature: string;
  amount: string;
}

/**
 * Check faucet availability for a specific token.
 * Backend handles WSOL ↔ native mapping automatically.
 */
export function useFaucetStatus(
  userAddress: string | undefined,
  token: string,
  enabled = true,
) {
  return useQuery({
    queryKey: ["faucet-status", userAddress, token],
    queryFn: () =>
      api.get<FaucetSingleStatus>(`/faucet/status`, {
        address: userAddress,
        token,
      }),
    staleTime: 30_000,
    enabled: enabled && !!userAddress,
  });
}

export function useClaimFaucet(userAddress: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ token, authToken }: { token: string; authToken: string }) => {
      return api.post<ClaimResult>("/faucet/claim", { token }, authToken);
    },
    onSuccess: (_data, variables) => {
      toast.success("Faucet tokens claimed successfully!");
      // Invalidate faucet status queries
      queryClient.invalidateQueries({ queryKey: ["faucet-status", userAddress, variables.token] });
    },
    onError: (err: any) => {
      toast.error(err?.message ?? "Failed to claim faucet");
    },
  });
}
