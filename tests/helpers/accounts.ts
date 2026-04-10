import { PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { ctx } from "./context";

export async function airdropSol(pubkey: PublicKey, amount = 10 * LAMPORTS_PER_SOL) {
  const sig = await ctx.provider.connection.requestAirdrop(pubkey, amount);
  await ctx.provider.connection.confirmTransaction(sig, "confirmed");
}

export async function getOrCreateAta(
  mint: PublicKey,
  owner: PublicKey,
  payer: Keypair
): Promise<PublicKey> {
  const account = await getOrCreateAssociatedTokenAccount(
    ctx.provider.connection,
    payer,
    mint,
    owner
  );
  return account.address;
}

export async function mintTokens(
  mint: PublicKey,
  dest: PublicKey,
  authority: Keypair,
  amount: number | bigint
) {
  await mintTo(ctx.provider.connection, authority, mint, dest, authority, amount);
}
