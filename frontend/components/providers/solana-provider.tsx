"use client";

import { useMemo, useState, useCallback, type ReactNode } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { type WalletError } from "@solana/wallet-adapter-base";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { env } from "@/lib/env";

import "@solana/wallet-adapter-react-ui/styles.css";

export function SolanaProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );

  // Catch wallet adapter errors that aren't caught by individual handlers.
  // Without this, unhandled wallet errors can crash the React tree.
  const onError = useCallback((error: WalletError) => {
    console.warn("Wallet error:", error.message);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider endpoint={env.rpcUrl} config={{ commitment: "confirmed" }}>
        <WalletProvider wallets={wallets} autoConnect onError={onError}>
          <WalletModalProvider>{children}</WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </QueryClientProvider>
  );
}
