import { PublicKey, SystemProgram } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import type { DekantPm } from "./program/dekant_pm";
import { deriveProtocolConfig, deriveUserRole } from "./solana";
import { Role } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the authority's Admin role PDA if not superadmin, or null if superadmin. */
function resolveAuthorityRole(
  authority: PublicKey,
  isSuperadmin: boolean,
): PublicKey | null {
  if (isSuperadmin) return null;
  const [pda] = deriveUserRole(authority, Role.Admin);
  return pda;
}

// ---------------------------------------------------------------------------
// Role management
// ---------------------------------------------------------------------------

export async function executeAssignRole(
  program: Program<DekantPm>,
  authority: PublicKey,
  targetUser: PublicKey,
  role: number,
  isSuperadmin: boolean,
): Promise<string> {
  const [protocolConfig] = deriveProtocolConfig();
  const [userRole] = deriveUserRole(targetUser, role);
  const authorityRole = resolveAuthorityRole(authority, isSuperadmin);

  return program.methods
    .assignRole({ role })
    .accountsPartial({
      authority,
      protocolConfig,
      authorityRole,
      targetUser,
      userRole,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function executeRevokeRole(
  program: Program<DekantPm>,
  authority: PublicKey,
  targetUser: PublicKey,
  role: number,
  isSuperadmin: boolean,
): Promise<string> {
  const [protocolConfig] = deriveProtocolConfig();
  const [userRole] = deriveUserRole(targetUser, role);
  const authorityRole = resolveAuthorityRole(authority, isSuperadmin);

  return program.methods
    .revokeRole({ role })
    .accountsPartial({
      authority,
      protocolConfig,
      authorityRole,
      targetUser,
      userRole,
    })
    .rpc();
}

// ---------------------------------------------------------------------------
// Fee management (superadmin only)
// ---------------------------------------------------------------------------

export async function executeUpdateFees(
  program: Program<DekantPm>,
  authority: PublicKey,
  fees: {
    creationFeeBps: number;
    tradeFeeBps: number;
    redemptionFeeBps: number;
    lpFeeShareBps: number;
  },
): Promise<string> {
  const [protocolConfig] = deriveProtocolConfig();

  return program.methods
    .updateFees(fees)
    .accountsPartial({
      authority,
      protocolConfig,
    })
    .rpc();
}

// ---------------------------------------------------------------------------
// Market controls
// ---------------------------------------------------------------------------

export async function executePauseMarket(
  program: Program<DekantPm>,
  authority: PublicKey,
  marketPubkey: PublicKey,
  isSuperadmin: boolean,
): Promise<string> {
  const [protocolConfig] = deriveProtocolConfig();
  const authorityRole = resolveAuthorityRole(authority, isSuperadmin);

  return program.methods
    .pauseMarket()
    .accountsPartial({
      authority,
      protocolConfig,
      authorityRole,
      market: marketPubkey,
    })
    .rpc();
}

export async function executeUnpauseMarket(
  program: Program<DekantPm>,
  authority: PublicKey,
  marketPubkey: PublicKey,
  isSuperadmin: boolean,
): Promise<string> {
  const [protocolConfig] = deriveProtocolConfig();
  const authorityRole = resolveAuthorityRole(authority, isSuperadmin);

  return program.methods
    .unpauseMarket()
    .accountsPartial({
      authority,
      protocolConfig,
      authorityRole,
      market: marketPubkey,
    })
    .rpc();
}
