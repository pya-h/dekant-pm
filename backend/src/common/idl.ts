import { PublicKey } from '@solana/web3.js';
import * as path from 'path';
import * as fs from 'fs';

// Try bundled IDL first (Docker), fall back to monorepo target (local dev)
const bundledPath = path.resolve(__dirname, '../../idl/dekant_pm.json');
const monoRepoPath = path.resolve(__dirname, '../../../target/idl/dekant_pm.json');
const idlPath = fs.existsSync(bundledPath) ? bundledPath : monoRepoPath;
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const IDL = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));

export const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID || 'F7dR6Ho8aCm9SBD2aNfJChTdpQpNvPmKjXZGSfjLZHKL',
);
