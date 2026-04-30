"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useAdminRole } from "@/hooks/use-admin-role";
import { CreatorDashboard } from "@/components/creator/creator-dashboard";
import { Button } from "@/components/ui/button";
import { Wallet, ShieldAlert, Loader2 } from "lucide-react";

export default function CreatorPage() {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const {
    isSuperadmin,
    isAdmin,
    isCreator,
    isLoading: roleLoading,
  } = useAdminRole();

  const canAccess = isSuperadmin || isAdmin || isCreator;

  if (!connected) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-6 text-center">
          <div className="rounded-full bg-muted p-4">
            <Wallet className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Connect your wallet</h1>
            <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
              Connect a wallet with Creator, Admin, or Superadmin role to access
              the creator dashboard.
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
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Checking permissions...
          </p>
        </div>
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
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
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <CreatorDashboard />
    </div>
  );
}
