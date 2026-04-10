import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';

const PROTOCOL_CONFIG_SEED = 'protocol_config';
const USER_ROLE_SEED = 'user_role';
const MARKET_SEED = 'market';
const VAULT_AUTHORITY_SEED = 'vault_authority';
const USER_POSITION_SEED = 'user_position';
const LP_POSITION_SEED = 'lp_position';

export function deriveProtocolConfig(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PROTOCOL_CONFIG_SEED)],
    programId,
  );
}

export function deriveUserRole(
  programId: PublicKey,
  user: PublicKey,
  role: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(USER_ROLE_SEED), user.toBuffer(), Buffer.from([role])],
    programId,
  );
}

export function deriveMarket(
  programId: PublicKey,
  marketCount: number,
): [PublicKey, number] {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(marketCount));
  return PublicKey.findProgramAddressSync(
    [Buffer.from(MARKET_SEED), buf],
    programId,
  );
}

export function deriveVaultAuthority(
  programId: PublicKey,
  marketPubkey: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(VAULT_AUTHORITY_SEED), marketPubkey.toBuffer()],
    programId,
  );
}

export function deriveUserPosition(
  programId: PublicKey,
  marketPubkey: PublicKey,
  user: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(USER_POSITION_SEED),
      marketPubkey.toBuffer(),
      user.toBuffer(),
    ],
    programId,
  );
}

export function deriveLpPosition(
  programId: PublicKey,
  marketPubkey: PublicKey,
  user: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(LP_POSITION_SEED), marketPubkey.toBuffer(), user.toBuffer()],
    programId,
  );
}
