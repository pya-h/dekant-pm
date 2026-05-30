#!/usr/bin/env ts-node
/**
 * Backend-side market metadata management.
 *
 * On-chain `createMarket` does not carry a subject/category/title — those live
 * only in the backend DB. The frontend writes them via JWT-authenticated
 * `POST /markets` (during creation) and `PATCH /markets/:id` (later edits).
 *
 * This devkit command lets the smoke test (and any other devkit caller) reach
 * the same PATCH endpoint without going through a browser wallet flow. It
 * performs the wallet-signing auth dance against the deployer's keypair,
 * caches nothing, and writes whatever subset of (subject, category, tags,
 * description, icon) the caller asks for.
 *
 * Requires the backend to be reachable at BACKEND_URL (default
 * http://localhost:4000). The deployer wallet must hold an Admin or Creator
 * role on the backend (the smoke flow grants Creator during reset).
 */
import { Command } from "commander";
import * as crypto from "node:crypto";
import { loadKeypair } from "./common";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:4000";

// PKCS8 DER prefix for ed25519 private keys (RFC 8410). Append the 32-byte
// seed to get a valid DER blob that node:crypto can import directly — saves
// pulling in tweetnacl just to sign a 100-byte challenge.
const PKCS8_ED25519_PREFIX = Buffer.from(
  "302e020100300506032b657004220420",
  "hex",
);

function signEd25519(message: Buffer, secretKey: Uint8Array): Buffer {
  // Solana's Keypair.secretKey is the 64-byte expanded form [seed(32), pub(32)].
  const seed = Buffer.from(secretKey.slice(0, 32));
  const pkcs8 = Buffer.concat([PKCS8_ED25519_PREFIX, seed]);
  const privKey = crypto.createPrivateKey({
    key: pkcs8,
    format: "der",
    type: "pkcs8",
  });
  return crypto.sign(null, message, privKey);
}

async function authenticate(
  walletAddress: string,
  secretKey: Uint8Array,
): Promise<string> {
  const challengeRes = await fetch(`${BACKEND_URL}/auth/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress }),
  });
  if (!challengeRes.ok) {
    throw new Error(
      `POST /auth/challenge failed: ${challengeRes.status} ${await challengeRes.text()}`,
    );
  }
  const { nonce, message } = (await challengeRes.json()) as {
    nonce: string;
    message: string;
  };

  const signature = signEd25519(
    Buffer.from(message, "utf-8"),
    secretKey,
  ).toString("base64");

  const verifyRes = await fetch(`${BACKEND_URL}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress, signature, nonce }),
  });
  if (!verifyRes.ok) {
    throw new Error(
      `POST /auth/verify failed: ${verifyRes.status} ${await verifyRes.text()}`,
    );
  }
  const { accessToken } = (await verifyRes.json()) as { accessToken: string };
  if (!accessToken) throw new Error("Auth verify response missing accessToken");
  return accessToken;
}

async function patchWithRetry(
  marketId: string,
  body: Record<string, unknown>,
  token: string,
  attempts = 6,
): Promise<unknown> {
  // The indexer inserts the DB row asynchronously after the on-chain
  // MarketCreated event. PATCH may 404 if we race it; back off and retry.
  let lastErr = "";
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(`${BACKEND_URL}/markets/${marketId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    if (res.status !== 404) {
      throw new Error(
        `PATCH /markets/${marketId} failed: ${res.status} ${await res.text()}`,
      );
    }
    lastErr = `404 (attempt ${i + 1}/${attempts})`;
    // 250ms, 500ms, 750ms, 1000ms, 1250ms, 1500ms — ~5.25s total
    await new Promise((r) => setTimeout(r, 250 * (i + 1)));
  }
  throw new Error(`PATCH /markets/${marketId} gave up: ${lastErr}`);
}

const program_ = new Command();
program_
  .name("metadata")
  .description("Backend market-metadata helpers (requires backend running)");

program_
  .command("patch")
  .description(
    "Auth as the deployer wallet and PATCH /markets/:id with metadata fields",
  )
  .argument("<market-id>", "Numeric market ID")
  .option("--subject <s>", "Subject (e.g. BTC, ETH, NBA-Finals)")
  .option("--category <c>", "Category (e.g. crypto, sports, politics)")
  .option(
    "--tags <list>",
    "Comma-separated tag list (e.g. q3,price,speculation)",
  )
  .option("--description <d>", "Description text")
  .option("--icon <url>", "Icon URL or key")
  .action(async (marketId: string, opts) => {
    const keypair = loadKeypair();
    const walletAddress = keypair.publicKey.toBase58();

    const body: Record<string, unknown> = {};
    if (opts.subject) body.subject = opts.subject;
    if (opts.category) body.category = opts.category;
    if (opts.tags) {
      body.tags = opts.tags
        .split(",")
        .map((t: string) => t.trim())
        .filter(Boolean);
    }
    if (opts.description) body.description = opts.description;
    if (opts.icon) body.icon = opts.icon;

    if (Object.keys(body).length === 0) {
      console.error(
        "Nothing to patch — pass at least one of --subject/--category/--tags/--description/--icon",
      );
      process.exit(2);
    }

    const token = await authenticate(walletAddress, keypair.secretKey);
    await patchWithRetry(marketId, body, token);
    console.log(`  Patched market #${marketId}: ${JSON.stringify(body)}`);
  });

program_.parseAsync(process.argv).catch((err: Error) => {
  console.error(`metadata: ${err.message}`);
  process.exit(1);
});
