"use client";

import { useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useAdminRole } from "@/hooks/use-admin-role";
import { useAuth } from "@/hooks/use-auth";
import { CreateMarketForm } from "@/components/create-market/create-market-form";
import { Button } from "@/components/ui/button";
import { Wallet, ShieldAlert, Loader2, PlusCircle } from "lucide-react";
import Link from "next/link";

export default function CreateMarketPage() {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const {
    isSuperadmin,
    isAdmin,
    isCreator,
    isAuthorized,
    isLoading: roleLoading,
  } = useAdminRole();
  const {
    token,
    isAuthenticated,
    isAuthenticating,
    authenticate,
    error: authError,
  } = useAuth();

  const canCreate = isAuthorized || isCreator;

  // Auto-authenticate once role is confirmed
  useEffect(() => {
    if (canCreate && !isAuthenticated && !isAuthenticating && !authError) {
      authenticate().catch(() => {});
    }
  }, [canCreate, isAuthenticated, isAuthenticating, authenticate, authError]);

  if (!connected) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-6 text-center">
          <div className="rounded-full bg-muted p-4">
            <Wallet className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Connect your wallet</h1>
            <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
              Connect a wallet with Creator, Admin, or Superadmin role to create
              a market.
            </p>
          </div>
          <Button
            size="lg"
            onClick={() => setVisible(true)}
            className="gap-2"
          >
            <Wallet className="h-4 w-4" />
            Connect Wallet
          </Button>
        </div>
      </div>
    );
  }

  if (roleLoading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Checking permissions...
          </p>
        </div>
      </div>
    );
  }

  if (!canCreate) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-6 text-center">
          <div className="rounded-full bg-destructive/10 p-4">
            <ShieldAlert className="h-8 w-8 text-destructive" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Access Denied</h1>
            <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
              Your wallet does not have Creator, Admin, or Superadmin
              privileges. Contact the protocol admin to get access.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <nav className="text-sm text-muted-foreground">
        <Link
          href="/creator"
          className="transition-colors hover:text-foreground"
        >
          Creator Dashboard
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Create Market</span>
      </nav>

      {/* Header */}
      <div className="flex items-center gap-3">
        <PlusCircle className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Create Market</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Create a new prediction market on-chain
          </p>
        </div>
      </div>

      {/* Auth error */}
      {authError && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-400">
          Authentication failed: {authError}. Market metadata may not be saved.
          <Button
            variant="link"
            size="sm"
            className="ml-2 h-auto p-0 text-amber-400 underline"
            onClick={() => authenticate().catch(() => {})}
          >
            Retry
          </Button>
        </div>
      )}

      {/* Auth in progress */}
      {isAuthenticating && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Signing authentication message...
        </div>
      )}

      <CreateMarketForm
        token={token}
        isSuperadmin={isSuperadmin}
        isAdmin={isAdmin}
      />
    </div>
  );
}
