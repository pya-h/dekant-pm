import { PublicKey } from '@solana/web3.js';
import * as path from 'path';
import * as fs from 'fs';

const idlPath = path.resolve(__dirname, '../../../target/idl/dekant_pm.json');
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const IDL = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));

export const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID || 'Fa2ookSb6meqem6F1oZcVv1PAxQzNtr7zkf1XiDBFgAf',
);
