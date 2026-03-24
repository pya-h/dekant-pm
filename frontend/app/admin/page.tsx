"use client";

import { useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useAdminRole } from "@/hooks/use-admin-role";
import { useAuth } from "@/hooks/use-auth";
import { RoleManager } from "@/components/admin/role-manager";
import { FeeConfig } from "@/components/admin/fee-config";
import { FeeCollector } from "@/components/admin/fee-collector";
import { PauseControls } from "@/components/admin/pause-controls";
import { ProtocolSettings } from "@/components/admin/protocol-settings";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Wallet, ShieldAlert, Loader2, Shield, PlusCircle } from "lucide-react";
import Link from "next/link";

export default function AdminPage() {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const { isSuperadmin, isAuthorized, isLoading: roleLoading } = useAdminRole();
  const {
    token,
    isAuthenticated,
    isAuthenticating,
    authenticate,
    error: authError,
  } = useAuth();

  // Auto-authenticate once role is confirmed
  useEffect(() => {
    if (isAuthorized && !isAuthenticated && !isAuthenticating && !authError) {
      authenticate().catch(() => {});
    }
  }, [isAuthorized, isAuthenticated, isAuthenticating, authenticate, authError]);

  // Not connected
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
              Connect a wallet with Admin or Superadmin role to access the
              dashboard.
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

  // Checking role
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

  // Not authorized
  if (!isAuthorized) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-6 text-center">
          <div className="rounded-full bg-destructive/10 p-4">
            <ShieldAlert className="h-8 w-8 text-destructive" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Access Denied</h1>
            <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
              Your connected wallet does not have Admin or Superadmin
              privileges. Contact the protocol superadmin to get access.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Admin Dashboard
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {isSuperadmin ? "Superadmin" : "Admin"} &mdash; Manage roles,
              fees, and market controls
            </p>
          </div>
        </div>
        <Link href="/admin/create-market">
          <Button className="gap-2">
            <PlusCircle className="h-4 w-4" />
            Create Market
          </Button>
        </Link>
      </div>

      {/* Auth error */}
      {authError && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-400">
          Authentication failed: {authError}. Role list may be unavailable.
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

      {/* Tabbed sections */}
      <Tabs defaultValue="roles">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:overflow-visible sm:px-0">
          <TabsList>
            <TabsTrigger value="roles">Roles</TabsTrigger>
            {isSuperadmin && <TabsTrigger value="fees">Fees</TabsTrigger>}
            {isSuperadmin && <TabsTrigger value="collect">Collect Fees</TabsTrigger>}
            {isSuperadmin && <TabsTrigger value="settings">Settings</TabsTrigger>}
            <TabsTrigger value="controls">Market Controls</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="roles" className="mt-4">
          <RoleManager token={token} isSuperadmin={isSuperadmin} />
        </TabsContent>

        {isSuperadmin && (
          <TabsContent value="fees" className="mt-4">
            <FeeConfig isSuperadmin={isSuperadmin} />
          </TabsContent>
        )}

        {isSuperadmin && (
          <TabsContent value="collect" className="mt-4">
            <FeeCollector />
          </TabsContent>
        )}

        {isSuperadmin && (
          <TabsContent value="settings" className="mt-4">
            <ProtocolSettings token={token} />
          </TabsContent>
        )}

        <TabsContent value="controls" className="mt-4">
          <PauseControls isSuperadmin={isSuperadmin} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
