import { SystemProgram } from "@solana/web3.js";
import { createMint } from "@solana/spl-token";
import { ctx } from "./context";
import { findProtocolConfig, findUserRole } from "./pda";
import { airdropSol } from "./accounts";
import { ROLE_ADMIN, ROLE_ORACLE, ROLE_CREATOR } from "./constants";

let initialized = false;

export async function ensureSetup() {
  if (initialized) return;

  await Promise.all([
    airdropSol(ctx.oracleKp.publicKey),
    airdropSol(ctx.creatorKp.publicKey),
    airdropSol(ctx.adminKp.publicKey),
    airdropSol(ctx.traderA.publicKey),
    airdropSol(ctx.traderB.publicKey),
    airdropSol(ctx.lpProvider.publicKey),
    airdropSol(ctx.treasury.publicKey),
  ]);

  ctx.collateralMint = await createMint(
    ctx.provider.connection,
    (ctx.superadmin as any).payer,
    ctx.superadmin.publicKey,
    null,
    6
  );

  const [protocolConfig, bump] = findProtocolConfig(ctx.program.programId);
  ctx.protocolConfig = protocolConfig;
  ctx.protocolConfigBump = bump;

  await ctx.program.methods
    .initialize({ treasury: ctx.treasury.publicKey })
    .accountsPartial({
      authority: ctx.superadmin.publicKey,
      protocolConfig: ctx.protocolConfig,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const [oracleRolePda] = findUserRole(
    ctx.oracleKp.publicKey,
    ROLE_ORACLE,
    ctx.program.programId
  );
  await ctx.program.methods
    .assignRole({ role: ROLE_ORACLE })
    .accountsPartial({
      authority: ctx.superadmin.publicKey,
      protocolConfig: ctx.protocolConfig,
      authorityRole: null,
      targetUser: ctx.oracleKp.publicKey,
      userRole: oracleRolePda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const [creatorRolePda] = findUserRole(
    ctx.creatorKp.publicKey,
    ROLE_CREATOR,
    ctx.program.programId
  );
  await ctx.program.methods
    .assignRole({ role: ROLE_CREATOR })
    .accountsPartial({
      authority: ctx.superadmin.publicKey,
      protocolConfig: ctx.protocolConfig,
      authorityRole: null,
      targetUser: ctx.creatorKp.publicKey,
      userRole: creatorRolePda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const [adminRolePda] = findUserRole(
    ctx.adminKp.publicKey,
    ROLE_ADMIN,
    ctx.program.programId
  );
  await ctx.program.methods
    .assignRole({ role: ROLE_ADMIN })
    .accountsPartial({
      authority: ctx.superadmin.publicKey,
      protocolConfig: ctx.protocolConfig,
      authorityRole: null,
      targetUser: ctx.adminKp.publicKey,
      userRole: adminRolePda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  initialized = true;
}
