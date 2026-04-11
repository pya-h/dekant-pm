"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useQueryClient } from "@tanstack/react-query";
import { useProgram } from "@/lib/solana";
import { useAdminRoles } from "@/hooks/use-admin-roles";
import { executeAssignRole, executeRevokeRole } from "@/lib/admin-transactions";
import { showTradeSuccess, showTradeError } from "@/components/common/transaction-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Role, type UserRoleEntry } from "@/lib/types";
import { Loader2, UserPlus, Trash2 } from "lucide-react";

const ROLE_LABELS: Record<number, string> = {
  [Role.Admin]: "Admin",
  [Role.Oracle]: "Oracle",
  [Role.Creator]: "Creator",
};

const ROLE_COLORS: Record<number, string> = {
  [Role.Admin]: "border-rose-500/30 bg-rose-500/10 text-rose-400",
  [Role.Oracle]: "border-violet-500/30 bg-violet-500/10 text-violet-400",
  [Role.Creator]: "border-sky-500/30 bg-sky-500/10 text-sky-400",
};

interface RoleManagerProps {
  token: string | null;
  isSuperadmin: boolean;
}

export function RoleManager({ token, isSuperadmin }: RoleManagerProps) {
  const program = useProgram();
  const { publicKey } = useWallet();
  const queryClient = useQueryClient();
  const { data: roles, isLoading, isError } = useAdminRoles(token);

  const [address, setAddress] = useState("");
  const [role, setRole] = useState<number>(Role.Oracle);
  const [assigning, setAssigning] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const handleAssign = async () => {
    if (!program || !publicKey || !address.trim()) return;

    let targetUser: PublicKey;
    try {
      targetUser = new PublicKey(address.trim());
    } catch {
      showTradeError(new Error("Invalid wallet address"));
      return;
    }

    setAssigning(true);
    try {
      const sig = await executeAssignRole(
        program,
        publicKey,
        targetUser,
        role,
        isSuperadmin,
      );
      showTradeSuccess(sig, "Role assigned");
      setAddress("");
      // Delay invalidation to give the indexer time to pick up the event
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["adminRoles"] }), 3000);
    } catch (err) {
      showTradeError(err);
    } finally {
      setAssigning(false);
    }
  };

  const handleRevoke = async (entry: UserRoleEntry) => {
    if (!program || !publicKey) return;

    setRevokingId(entry.id);
    try {
      const targetUser = new PublicKey(entry.userAddress);
      const sig = await executeRevokeRole(
        program,
        publicKey,
        targetUser,
        entry.role,
        isSuperadmin,
      );
      showTradeSuccess(sig, "Role revoked");
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["adminRoles"] }), 3000);
    } catch (err) {
      showTradeError(err);
    } finally {
      setRevokingId(null);
    }
  };

  // Available roles: Admin only assigns Oracle/Creator, Superadmin assigns all
  const availableRoles = isSuperadmin
    ? [Role.Admin, Role.Oracle, Role.Creator]
    : [Role.Oracle, Role.Creator];

  return (
    <div className="space-y-6">
      {/* Assign role form */}
      <div className="rounded-xl border border-border/40 bg-card/50 p-5">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Assign Role
        </h3>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1.5 block text-xs text-muted-foreground">
              Wallet Address
            </label>
            <Input
              placeholder="Base58 public key..."
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="font-mono text-sm"
            />
          </div>
          <div className="w-full sm:w-36">
            <label className="mb-1.5 block text-xs text-muted-foreground">
              Role
            </label>
            <select
              value={role}
              onChange={(e) => setRole(Number(e.target.value))}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {availableRoles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
          <Button
            onClick={handleAssign}
            disabled={assigning || !address.trim() || !program}
            className="gap-2"
          >
            {assigning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            Assign
          </Button>
        </div>
      </div>

      {/* Role list */}
      <div className="rounded-xl border border-border/40 bg-card/50">
        <div className="border-b border-border/40 px-5 py-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Current Roles
          </h3>
        </div>

        {!token ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Authenticating...
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <div className="p-8 text-center text-sm text-destructive">
            Failed to load roles
          </div>
        ) : !roles || roles.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No roles assigned yet
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {roles.map((entry) => (
              <RoleRow
                key={entry.id}
                entry={entry}
                onRevoke={handleRevoke}
                revoking={revokingId === entry.id}
                canRevoke={
                  isSuperadmin ||
                  (entry.role !== Role.Admin)
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RoleRow({
  entry,
  onRevoke,
  revoking,
  canRevoke,
}: {
  entry: UserRoleEntry;
  onRevoke: (entry: UserRoleEntry) => void;
  revoking: boolean;
  canRevoke: boolean;
}) {
  const colorClass = ROLE_COLORS[entry.role] ?? "border-zinc-500/30 bg-zinc-500/10 text-zinc-400";
  const label = ROLE_LABELS[entry.role] ?? `Role ${entry.role}`;

  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-sm">{entry.userAddress}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          by {truncateAddress(entry.assignedBy)} &middot;{" "}
          {new Date(entry.assignedAt).toLocaleDateString()}
        </div>
      </div>
      <Badge
        variant="outline"
        className={`text-[11px] font-medium ${colorClass}`}
      >
        {label}
      </Badge>
      {canRevoke && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={() => onRevoke(entry)}
          disabled={revoking}
        >
          {revoking ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </Button>
      )}
    </div>
  );
}

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}
