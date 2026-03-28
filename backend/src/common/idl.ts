import { PublicKey } from '@solana/web3.js';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config();

// Try bundled IDL first (Docker), fall back to monorepo target (local dev)
const bundledPath = path.resolve(__dirname, '../../idl/dekant_pm.json');
const monoRepoPath = path.resolve(__dirname, '../../../target/idl/dekant_pm.json');
const idlPath = fs.existsSync(bundledPath) ? bundledPath : monoRepoPath;
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const IDL = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));

const programIdStr = process.env.PROGRAM_ID;
if (!programIdStr) {
  throw new Error('PROGRAM_ID environment variable is not set. Set it in .env or export it directly.');
}
export const PROGRAM_ID = new PublicKey(programIdStr);
