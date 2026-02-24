import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { DekantPm } from "../../target/types/dekant_pm";

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

const program = anchor.workspace.DekantPm as Program<DekantPm>;
const superadmin = provider.wallet as anchor.Wallet;

export const ctx = {
  provider,
  program,
  superadmin,
  treasury: Keypair.generate(),
  oracleKp: Keypair.generate(),
  creatorKp: Keypair.generate(),
  adminKp: Keypair.generate(),
  traderA: Keypair.generate(),
  traderB: Keypair.generate(),
  lpProvider: Keypair.generate(),
  collateralMint: null as unknown as PublicKey,
  protocolConfig: null as unknown as PublicKey,
  protocolConfigBump: 0,
};
