"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "sonner";

export interface FaucetTokenStatus {
  token: string;
  label: string;
  available: boolean;
  remainingClaims: number;
  amountPerRequest: string;
}

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

export function useFaucetAllStatuses(userAddress: string | undefined) {
  return useQuery({
    queryKey: ["faucet-status-all", userAddress],
    queryFn: () =>
      api.get<FaucetTokenStatus[]>(`/faucet/status/all`, {
        address: userAddress,
      }),
    staleTime: 30_000,
    enabled: !!userAddress,
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
      queryClient.invalidateQueries({ queryKey: ["faucet-status-all", userAddress] });
    },
    onError: (err: any) => {
      toast.error(err?.message ?? "Failed to claim faucet");
    },
  });
}
