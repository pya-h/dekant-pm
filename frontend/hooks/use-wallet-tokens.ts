"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

export interface WalletToken {
  mint: string;
  balance: number;
  decimals: number;
  uiAmount: number;
}

/**
 * Fetches all SPL token accounts owned by the wallet that have a non-zero balance.
 */
export function useWalletTokens(owner: string | undefined) {
  const { connection } = useConnection();

  return useQuery<WalletToken[]>({
    queryKey: ["walletTokens", owner],
    queryFn: async () => {
      if (!owner) return [];
      const ownerPubkey = new PublicKey(owner);
      const response = await connection.getParsedTokenAccountsByOwner(
        ownerPubkey,
        { programId: TOKEN_PROGRAM_ID },
      );

      return response.value
        .map(({ account }) => {
          const info = account.data.parsed.info;
          return {
            mint: info.mint as string,
            balance: Number(info.tokenAmount.amount),
            decimals: info.tokenAmount.decimals as number,
            uiAmount: info.tokenAmount.uiAmount as number,
          };
        })
        .filter((t) => t.balance > 0)
        .sort((a, b) => b.uiAmount - a.uiAmount);
    },
    enabled: !!owner,
    staleTime: 30_000,
  });
}
