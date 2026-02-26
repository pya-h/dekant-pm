"use client";

import dynamic from "next/dynamic";

const WalletMultiButtonDynamic = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  {
    ssr: false,
    loading: () => (
      <div
        className="animate-pulse rounded-[var(--radius)] bg-muted"
        style={{ height: "2.5rem", width: "10rem" }}
      />
    ),
  },
);

export function WalletButton() {
  return (
    <WalletMultiButtonDynamic
      style={{
        backgroundColor: "var(--primary)",
        color: "var(--primary-foreground)",
        borderRadius: "var(--radius)",
        fontSize: "0.875rem",
        height: "2.5rem",
        padding: "0 1rem",
      }}
    />
  );
}
