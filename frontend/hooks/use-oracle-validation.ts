"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { deriveUserRole } from "@/lib/solana";
import { Role } from "@/lib/types";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export interface OracleValidation {
  valid: boolean;
  error: string | null;
}

/**
 * Validates that an address has the Oracle role on-chain by checking
 * whether its UserRole PDA exists.
 */
export function useOracleValidation(oracle: string) {
  const { connection } = useConnection();

  return useQuery<OracleValidation>({
    queryKey: ["oracleValidation", oracle],
    queryFn: async () => {
      let pubkey: PublicKey;
      try {
        pubkey = new PublicKey(oracle);
      } catch {
        return { valid: false, error: "Invalid wallet address" };
      }

      const [rolePda] = deriveUserRole(pubkey, Role.Oracle);
      const info = await connection.getAccountInfo(rolePda);
      if (!info) {
        return {
          valid: false,
          error: "This wallet does not have the Oracle role assigned on-chain",
        };
      }
      return { valid: true, error: null };
    },
    enabled: BASE58_RE.test(oracle),
    staleTime: 30_000,
    retry: 1,
  });
}
