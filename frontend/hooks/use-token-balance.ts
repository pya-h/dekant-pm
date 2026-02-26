"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

function getAta(mint: PublicKey, owner: PublicKey): PublicKey {
  const [address] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return address;
}

/**
 * Fetches the user's SPL token balance for the given mint.
 * Returns the raw amount in base units (e.g. 1_000_000 = 1 USDC).
 * Returns 0 if the ATA doesn't exist.
 */
export function useTokenBalance(
  mint: string | undefined,
  owner: string | undefined,
) {
  const { connection } = useConnection();

  return useQuery({
    queryKey: ["tokenBalance", mint, owner],
    queryFn: async () => {
      if (!mint || !owner) return 0;
      const ata = getAta(new PublicKey(mint), new PublicKey(owner));
      try {
        const resp = await connection.getTokenAccountBalance(ata);
        return Number(resp.value.amount);
      } catch {
        // ATA doesn't exist yet — balance is 0
        return 0;
      }
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
    enabled: !!mint && !!owner,
  });
}
