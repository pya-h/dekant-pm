// Next.js/Turbopack only inlines NEXT_PUBLIC_* when accessed as a static
// literal (process.env.NEXT_PUBLIC_X). Dynamic bracket access like
// process.env[key] is NOT replaced and will be undefined in the browser.
// All env reads below MUST use direct dot-access.

const programId = process.env.NEXT_PUBLIC_PROGRAM_ID;
if (!programId) {
  throw new Error(
    "NEXT_PUBLIC_PROGRAM_ID environment variable is not set. Set it in .env.local (dev) or .env.production (prod)."
  );
}

export const env = {
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "http://localhost:8899",
  backendUrl: process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000",
  programId,
  network: (process.env.NEXT_PUBLIC_NETWORK ?? "localnet") as "localnet" | "devnet" | "mainnet-beta",
} as const;
