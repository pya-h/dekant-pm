import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection } from "@solana/web3.js";
import * as fs from "fs";

// Load wallet
const walletKeyfile = JSON.parse(
  fs.readFileSync("/home/ai/.secrets/ai-wallet.json", "utf-8")
);
const walletKeypair = Keypair.fromSecretKey(Uint8Array.from(walletKeyfile));

// Setup connection + provider
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const wallet = new anchor.Wallet(walletKeypair);
const provider = new anchor.AnchorProvider(connection, wallet, {
  commitment: "confirmed",
});
anchor.setProvider(provider);

// Load IDL + program
const idl = JSON.parse(
  fs.readFileSync("target/idl/dekant_pm.json", "utf-8")
);
const programId = new PublicKey("4GYvtbs7da26tLaZt9PNQWLesq2riwEN6fi9tGF91A5P");
const program = new Program(idl, provider);

const PROTOCOL_CONFIG_SEED = Buffer.from("protocol_config");
const USER_ROLE_SEED = Buffer.from("user_role");

async function main() {
  const authority = walletKeypair.publicKey;
  console.log("Authority (superadmin):", authority.toBase58());

  // Derive protocol config PDA
  const [protocolConfig] = PublicKey.findProgramAddressSync(
    [PROTOCOL_CONFIG_SEED],
    programId
  );
  console.log("Protocol config PDA:", protocolConfig.toBase58());

  // Check if already initialized
  const configAccount = await connection.getAccountInfo(protocolConfig);
  if (configAccount) {
    console.log("Protocol already initialized!");
  } else {
    // Initialize — set ourselves as superadmin and treasury
    console.log("Initializing protocol...");
    const tx = await (program.methods as any)
      .initialize({ treasury: authority })
      .accounts({
        authority,
        protocolConfig,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([walletKeypair])
      .rpc();
    console.log("Initialize tx:", tx);
  }

  // Assign roles to ourselves: Oracle (2) and Creator (3)
  for (const [roleName, roleNum] of [["Oracle", 2], ["Creator", 3]] as const) {
    const [userRole] = PublicKey.findProgramAddressSync(
      [USER_ROLE_SEED, authority.toBuffer(), Buffer.from([roleNum])],
      programId
    );

    const roleAccount = await connection.getAccountInfo(userRole);
    if (roleAccount) {
      console.log(`${roleName} role already assigned`);
      continue;
    }

    console.log(`Assigning ${roleName} role...`);
    const tx = await (program.methods as any)
      .assignRole({ role: roleNum })
      .accounts({
        authority,
        protocolConfig,
        authorityRole: null,
        targetUser: authority,
        userRole,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([walletKeypair])
      .rpc();
    console.log(`${roleName} role tx:`, tx);
  }

  console.log("\nDone! Protocol initialized on devnet.");
  console.log("Program ID:", programId.toBase58());
  console.log("Superadmin:", authority.toBase58());
}

main().catch(console.error);
