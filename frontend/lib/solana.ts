"use client";

import { useMemo } from "react";
import { useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { env } from "./env";
import idl from "./program/dekant_pm.json";
import type { DekantPm } from "./program/dekant_pm";

export const PROGRAM_ID = new PublicKey(env.programId);

/** Returns an Anchor Program instance connected to the user's wallet, or null if disconnected. */
export function useProgram(): Program<DekantPm> | null {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  return useMemo(() => {
    if (!wallet) return null;
    const provider = new AnchorProvider(connection, wallet, {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    });
    return new Program<DekantPm>(idl as DekantPm, provider);
  }, [connection, wallet]);
}

// ---------------------------------------------------------------------------
// PDA derivation — pure functions (deterministic, no hooks needed)
// ---------------------------------------------------------------------------

export function deriveProtocolConfig(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_config")],
    PROGRAM_ID,
  );
}

export function deriveMarket(marketId: number | bigint): [PublicKey, number] {
  // Write a little-endian u64 without Buffer.writeBigUInt64LE (unavailable in browser polyfill)
  const buf = new Uint8Array(8);
  let n = BigInt(marketId);
  for (let i = 0; i < 8; i++) {
    buf[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), Buffer.from(buf)],
    PROGRAM_ID,
  );
}

export function deriveVaultAuthority(
  marketPubkey: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority"), marketPubkey.toBuffer()],
    PROGRAM_ID,
  );
}

export function deriveUserPosition(
  marketPubkey: PublicKey,
  userPubkey: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("user_position"),
      marketPubkey.toBuffer(),
      userPubkey.toBuffer(),
    ],
    PROGRAM_ID,
  );
}

export function deriveLpPosition(
  marketPubkey: PublicKey,
  userPubkey: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("lp_position"),
      marketPubkey.toBuffer(),
      userPubkey.toBuffer(),
    ],
    PROGRAM_ID,
  );
}

export function deriveUserRole(
  userPubkey: PublicKey,
  role: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_role"), userPubkey.toBuffer(), Buffer.from([role])],
    PROGRAM_ID,
  );
}
