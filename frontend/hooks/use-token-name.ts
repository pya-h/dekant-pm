"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

const WSOL_MINT = "So11111111111111111111111111111111111111112";
const METAPLEX_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

const KNOWN_MINTS: Record<string, string> = {
  [WSOL_MINT]: "SOL",
  native: "SOL",
};

function getMetadataPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      METAPLEX_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    METAPLEX_METADATA_PROGRAM_ID,
  );
  return pda;
}

function parseSymbol(data: Buffer): string | null {
  try {
    let offset = 65; // key(1) + update_authority(32) + mint(32)
    if (data.length < offset + 4) return null;
    const nameLen = data.readUInt32LE(offset);
    offset += 4 + nameLen; // skip name
    if (data.length < offset + 4) return null;
    const symbolLen = data.readUInt32LE(offset);
    offset += 4;
    if (data.length < offset + symbolLen) return null;
    return data
      .subarray(offset, offset + symbolLen)
      .toString("utf-8")
      .replace(/\0/g, "")
      .trim();
  } catch {
    return null;
  }
}

/**
 * Resolves a token mint address to a human-readable symbol/name.
 * Checks known mints first, then falls back to on-chain Metaplex metadata.
 */
export function useTokenName(mint: string | undefined) {
  const { connection } = useConnection();

  return useQuery({
    queryKey: ["tokenName", mint],
    queryFn: async () => {
      if (!mint) return null;
      if (KNOWN_MINTS[mint]) return KNOWN_MINTS[mint];

      try {
        const pda = getMetadataPda(new PublicKey(mint));
        const account = await connection.getAccountInfo(pda);
        if (account?.data) {
          const symbol = parseSymbol(Buffer.from(account.data));
          if (symbol) return symbol;
        }
      } catch {
        // metadata not found
      }
      // Fallback: truncated address
      return mint.slice(0, 4) + "…" + mint.slice(-4);
    },
    staleTime: Infinity, // token names don't change
    enabled: !!mint,
  });
}
