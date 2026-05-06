"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "sonner";

/** WSOL mint — used to map to "native" for faucet lookups */
const WSOL_MINT = "So11111111111111111111111111111111111111112";

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

/**
 * Check faucet availability for a specific token.
 * Handles WSOL ↔ native mapping automatically.
 */
export function useFaucetStatus(
  userAddress: string | undefined,
  token: string,
  enabled = true,
) {
  return useQuery({
    queryKey: ["faucet-status", userAddress, token],
    queryFn: async () => {
      // Try the exact token first
      const result = await api.get<FaucetSingleStatus>(`/faucet/status`, {
        address: userAddress,
        token,
      });
      // If found with remaining claims, return it
      if (result.remainingClaims > 0) return result;
      // Fallback: if token is WSOL, also try "native"
      if (token === WSOL_MINT) {
        const nativeResult = await api.get<FaucetSingleStatus>(`/faucet/status`, {
          address: userAddress,
          token: "native",
        });
        if (nativeResult.remainingClaims > 0) return nativeResult;
      }
      return result;
    },
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
