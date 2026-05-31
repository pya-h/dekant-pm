#!/usr/bin/env node
// Decode goperator-session.json secret keys into base58, the form Backpack
// (and other Solana wallets) accept under "Import Private Key".
//
// Usage:  node scripts/print-session-keys.js
//         node scripts/print-session-keys.js TraderX        # filter by label

const fs = require("fs");
const path = require("path");
const bs58 = require("bs58").default ?? require("bs58");

const SESSION_PATH = path.join(__dirname, ".state", "goperator-session.json");

const filter = process.argv[2];

const raw = fs.readFileSync(SESSION_PATH, "utf8");
const data = JSON.parse(raw);
const users = Array.isArray(data.users) ? data.users : [];

if (users.length === 0) {
  console.error("No users in session file:", SESSION_PATH);
  process.exit(1);
}

let printed = 0;
for (const u of users) {
  if (filter && u.label !== filter) continue;

  const bytes = Buffer.from(u.secretKey, "base64");
  if (bytes.length !== 64) {
    console.error(`! ${u.label}: expected 64 bytes, got ${bytes.length} — skipping`);
    continue;
  }
  const pubkey = bs58.encode(bytes.slice(32));
  const secretBase58 = bs58.encode(bytes);

  console.log(`# ${u.label}`);
  console.log(`  pubkey: ${pubkey}`);
  console.log(`  secret: ${secretBase58}`);
  console.log();
  printed++;
}

if (filter && printed === 0) {
  console.error(`No user matched label: ${filter}`);
  process.exit(1);
}
