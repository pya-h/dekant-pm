"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const MINT_ACCOUNT_SIZE = 82;

export interface MintValidation {
  valid: boolean;
  error: string | null;
}

/**
 * Validates that an address is a valid SPL Token Mint by checking:
 * 1. Account exists on-chain
 * 2. Account is owned by the Token Program
 * 3. Account data size matches Mint layout (82 bytes)
 */
export function useMintValidation(mint: string) {
  const { connection } = useConnection();

  return useQuery<MintValidation>({
    queryKey: ["mintValidation", mint],
    queryFn: async () => {
      let pubkey: PublicKey;
      try {
        pubkey = new PublicKey(mint);
      } catch {
        return { valid: false, error: "Invalid mint address" };
      }

      const info = await connection.getAccountInfo(pubkey);
      if (!info) {
        return {
          valid: false,
          error: "This account does not exist on-chain",
        };
      }

      if (!info.owner.equals(TOKEN_PROGRAM_ID)) {
        return {
          valid: false,
          error: "This address is not an SPL token mint",
        };
      }

      if (info.data.length !== MINT_ACCOUNT_SIZE) {
        return {
          valid: false,
          error: "This address is not a valid token mint",
        };
      }

      return { valid: true, error: null };
    },
    enabled: BASE58_RE.test(mint),
    staleTime: 60_000,
    retry: 1,
  });
}
