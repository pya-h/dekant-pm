"use client";

import { useState, useCallback, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { api } from "@/lib/api";

// Module-level token cache keyed by wallet address.
// Survives re-renders but not full page reloads (intentional for security).
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export function useAuth() {
  const { publicKey, signMessage, connected } = useWallet();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const address = publicKey?.toBase58();

  // Sync token state from cache when wallet changes
  useEffect(() => {
    if (!address) {
      setToken(null);
      setError(null);
      return;
    }
    const cached = tokenCache.get(address);
    if (cached && cached.expiresAt > Date.now()) {
      setToken(cached.token);
    } else {
      tokenCache.delete(address);
      setToken(null);
    }
    // Clear prior errors so auto-auth can retry with a new wallet
    setError(null);
  }, [address]);

  const authenticate = useCallback(async (): Promise<string> => {
    if (!address || !signMessage) {
      throw new Error("Wallet not connected or does not support message signing");
    }

    // Return cached token if still valid
    const cached = tokenCache.get(address);
    if (cached && cached.expiresAt > Date.now()) {
      setToken(cached.token);
      return cached.token;
    }

    setIsAuthenticating(true);
    setError(null);
    try {
      // Step 1: Get challenge from backend
      const { nonce, message } = await api.post<{
        nonce: string;
        message: string;
      }>("/auth/challenge", { walletAddress: address });

      // Step 2: Sign the challenge message with the wallet
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = await signMessage(messageBytes);
      const signature = Buffer.from(signatureBytes).toString("base64");

      // Step 3: Verify signature and get JWT
      const { accessToken } = await api.post<{ accessToken: string }>(
        "/auth/verify",
        { walletAddress: address, signature, nonce },
      );

      // Cache for 55 minutes (JWT typically lasts 1 hour)
      tokenCache.set(address, {
        token: accessToken,
        expiresAt: Date.now() + 55 * 60 * 1000,
      });
      setToken(accessToken);
      return accessToken;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      setError(msg);
      throw err;
    } finally {
      setIsAuthenticating(false);
    }
  }, [address, signMessage]);

  return {
    token,
    isAuthenticated: !!token,
    isAuthenticating,
    authenticate,
    error,
  };
}
