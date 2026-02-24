import { BN } from "@coral-xyz/anchor";

export const PROTOCOL_CONFIG_SEED = Buffer.from("protocol_config");
export const USER_ROLE_SEED = Buffer.from("user_role");
export const MARKET_SEED = Buffer.from("market");
export const VAULT_AUTHORITY_SEED = Buffer.from("vault_authority");
export const USER_POSITION_SEED = Buffer.from("user_position");
export const LP_POSITION_SEED = Buffer.from("lp_position");

export const ROLE_ADMIN = 1;
export const ROLE_ORACLE = 2;
export const ROLE_CREATOR = 3;

export const MARKET_TYPE_BINARY = 0;
export const MARKET_TYPE_MULTI = 1;
export const MARKET_TYPE_CONTINUOUS = 2;

export const SCALE = new BN("1000000000");
export const MIN_LIQUIDITY = new BN(1_000_000);
export const MIN_TRADE = new BN(1_000);

export function randomAmount(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}
