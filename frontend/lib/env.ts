function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} environment variable is not set. Set it in .env.local (dev) or .env.production (prod).`);
  }
  return value;
}

export const env = {
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "http://localhost:8899",
  backendUrl: process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000",
  programId: requireEnv("NEXT_PUBLIC_PROGRAM_ID"),
  network: (process.env.NEXT_PUBLIC_NETWORK ?? "localnet") as "localnet" | "devnet" | "mainnet-beta",
} as const;
