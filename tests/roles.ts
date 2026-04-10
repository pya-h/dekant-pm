import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import { ctx } from "./helpers/context";
import { ensureSetup } from "./helpers/setup";
import { findUserRole } from "./helpers/pda";
import { airdropSol } from "./helpers/accounts";
import { ROLE_ADMIN, ROLE_ORACLE, ROLE_CREATOR } from "./helpers/constants";

describe("Revoke Role", () => {
  const tempUser1 = Keypair.generate();
  const tempUser2 = Keypair.generate();

  before(async () => {
    await ensureSetup();

    await Promise.all([
      airdropSol(tempUser1.publicKey),
      airdropSol(tempUser2.publicKey),
    ]);

    const [oracleRolePda] = findUserRole(tempUser1.publicKey, ROLE_ORACLE, ctx.program.programId);
    const [creatorRolePda] = findUserRole(tempUser2.publicKey, ROLE_CREATOR, ctx.program.programId);

    await ctx.program.methods
      .assignRole({ role: ROLE_ORACLE })
      .accountsPartial({
        authority: ctx.superadmin.publicKey,
        protocolConfig: ctx.protocolConfig,
        authorityRole: null,
        targetUser: tempUser1.publicKey,
        userRole: oracleRolePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await ctx.program.methods
      .assignRole({ role: ROLE_CREATOR })
      .accountsPartial({
        authority: ctx.superadmin.publicKey,
        protocolConfig: ctx.protocolConfig,
        authorityRole: null,
        targetUser: tempUser2.publicKey,
        userRole: creatorRolePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  });

  it("superadmin revokes oracle role", async () => {
    const [oracleRolePda] = findUserRole(tempUser1.publicKey, ROLE_ORACLE, ctx.program.programId);

    const roleBefore = await ctx.program.account.userRole.fetch(oracleRolePda);
    expect(roleBefore.role).to.equal(ROLE_ORACLE);

    await ctx.program.methods
      .revokeRole({ role: ROLE_ORACLE })
      .accountsPartial({
        authority: ctx.superadmin.publicKey,
        protocolConfig: ctx.protocolConfig,
        authorityRole: null,
        targetUser: tempUser1.publicKey,
        userRole: oracleRolePda,
      })
      .rpc();

    try {
      await ctx.program.account.userRole.fetch(oracleRolePda);
      expect.fail("Role account should have been closed");
    } catch (err: any) {
      expect(err.toString()).to.include("Account does not exist");
    }
  });

  it("admin revokes creator role", async () => {
    const [adminRolePda] = findUserRole(ctx.adminKp.publicKey, ROLE_ADMIN, ctx.program.programId);
    const [creatorRolePda] = findUserRole(tempUser2.publicKey, ROLE_CREATOR, ctx.program.programId);

    await ctx.program.methods
      .revokeRole({ role: ROLE_CREATOR })
      .accountsPartial({
        authority: ctx.adminKp.publicKey,
        protocolConfig: ctx.protocolConfig,
        authorityRole: adminRolePda,
        targetUser: tempUser2.publicKey,
        userRole: creatorRolePda,
      })
      .signers([ctx.adminKp])
      .rpc();

    try {
      await ctx.program.account.userRole.fetch(creatorRolePda);
      expect.fail("Role account should have been closed");
    } catch (err: any) {
      expect(err.toString()).to.include("Account does not exist");
    }
  });

  it("admin cannot revoke admin role", async () => {
    const tempAdmin = Keypair.generate();
    await airdropSol(tempAdmin.publicKey);

    const [tempAdminRolePda] = findUserRole(tempAdmin.publicKey, ROLE_ADMIN, ctx.program.programId);
    await ctx.program.methods
      .assignRole({ role: ROLE_ADMIN })
      .accountsPartial({
        authority: ctx.superadmin.publicKey,
        protocolConfig: ctx.protocolConfig,
        authorityRole: null,
        targetUser: tempAdmin.publicKey,
        userRole: tempAdminRolePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const [adminRolePda] = findUserRole(ctx.adminKp.publicKey, ROLE_ADMIN, ctx.program.programId);

    try {
      await ctx.program.methods
        .revokeRole({ role: ROLE_ADMIN })
        .accountsPartial({
          authority: ctx.adminKp.publicKey,
          protocolConfig: ctx.protocolConfig,
          authorityRole: adminRolePda,
          targetUser: tempAdmin.publicKey,
          userRole: tempAdminRolePda,
        })
        .signers([ctx.adminKp])
        .rpc();
      expect.fail("Admin should not be able to revoke admin role");
    } catch (err: any) {
      expect(err.toString()).to.include("AdminCannotAssignAdmin");
    }

    // Cleanup
    await ctx.program.methods
      .revokeRole({ role: ROLE_ADMIN })
      .accountsPartial({
        authority: ctx.superadmin.publicKey,
        protocolConfig: ctx.protocolConfig,
        authorityRole: null,
        targetUser: tempAdmin.publicKey,
        userRole: tempAdminRolePda,
      })
      .rpc();
  });

  it("unauthorized user cannot revoke role", async () => {
    const [oracleRolePda] = findUserRole(tempUser1.publicKey, ROLE_ORACLE, ctx.program.programId);
    await ctx.program.methods
      .assignRole({ role: ROLE_ORACLE })
      .accountsPartial({
        authority: ctx.superadmin.publicKey,
        protocolConfig: ctx.protocolConfig,
        authorityRole: null,
        targetUser: tempUser1.publicKey,
        userRole: oracleRolePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const randomUser = Keypair.generate();
    await airdropSol(randomUser.publicKey);

    try {
      await ctx.program.methods
        .revokeRole({ role: ROLE_ORACLE })
        .accountsPartial({
          authority: randomUser.publicKey,
          protocolConfig: ctx.protocolConfig,
          authorityRole: null,
          targetUser: tempUser1.publicKey,
          userRole: oracleRolePda,
        })
        .signers([randomUser])
        .rpc();
      expect.fail("Random user should not be able to revoke roles");
    } catch (err: any) {
      expect(err.toString()).to.include("Unauthorized");
    }

    // Cleanup
    await ctx.program.methods
      .revokeRole({ role: ROLE_ORACLE })
      .accountsPartial({
        authority: ctx.superadmin.publicKey,
        protocolConfig: ctx.protocolConfig,
        authorityRole: null,
        targetUser: tempUser1.publicKey,
        userRole: oracleRolePda,
      })
      .rpc();
  });
});
