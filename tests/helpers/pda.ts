import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import {
  PROTOCOL_CONFIG_SEED,
  USER_ROLE_SEED,
  MARKET_SEED,
  VAULT_AUTHORITY_SEED,
  USER_POSITION_SEED,
  LP_POSITION_SEED,
} from "./constants";

export function findProtocolConfig(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([PROTOCOL_CONFIG_SEED], programId);
}

export function findUserRole(
  user: PublicKey,
  role: number,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [USER_ROLE_SEED, user.toBuffer(), Buffer.from([role])],
    programId
  );
}

export function findMarket(
  marketId: number | BN,
  programId: PublicKey
): [PublicKey, number] {
  const id = typeof marketId === "number" ? new BN(marketId) : marketId;
  return PublicKey.findProgramAddressSync(
    [MARKET_SEED, id.toArrayLike(Buffer, "le", 8)],
    programId
  );
}

export function findVaultAuthority(
  market: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_AUTHORITY_SEED, market.toBuffer()],
    programId
  );
}

export function findUserPosition(
  market: PublicKey,
  user: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [USER_POSITION_SEED, market.toBuffer(), user.toBuffer()],
    programId
  );
}

export function findLpPosition(
  market: PublicKey,
  user: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [LP_POSITION_SEED, market.toBuffer(), user.toBuffer()],
    programId
  );
}
