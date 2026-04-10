export const env = {
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "http://localhost:8899",
  backendUrl: process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001",
  programId: process.env.NEXT_PUBLIC_PROGRAM_ID ?? "Fa2ookSb6meqem6F1oZcVv1PAxQzNtr7zkf1XiDBFgAf",
  network: (process.env.NEXT_PUBLIC_NETWORK ?? "localnet") as "localnet" | "devnet" | "mainnet-beta",
} as const;
