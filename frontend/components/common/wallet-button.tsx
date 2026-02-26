"use client";

import dynamic from "next/dynamic";

const WalletMultiButtonDynamic = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false },
);

export function WalletButton() {
  return (
    <WalletMultiButtonDynamic
      style={{
        backgroundColor: "hsl(var(--primary))",
        color: "hsl(var(--primary-foreground))",
        borderRadius: "var(--radius)",
        fontSize: "0.875rem",
        height: "2.5rem",
        padding: "0 1rem",
      }}
    />
  );
}
