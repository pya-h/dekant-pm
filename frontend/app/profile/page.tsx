"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAuth } from "@/hooks/use-auth";
import { useProfile, useUpdateProfile } from "@/hooks/use-profile";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";

export default function ProfilePage() {
  const { connected, publicKey } = useWallet();
  const { token, authenticate, isAuthenticating } = useAuth();
  const { data: profile, isLoading } = useProfile(token);
  const updateProfile = useUpdateProfile(token);

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [avatar, setAvatar] = useState("");
  const [dirty, setDirty] = useState(false);

  // Sync form fields when profile loads
  useEffect(() => {
    if (profile) {
      setUsername(profile.username);
      setEmail(profile.email ?? "");
      setAvatar(profile.avatar ?? "");
      setDirty(false);
    }
  }, [profile]);

  // Auto-authenticate on connect
  useEffect(() => {
    if (connected && publicKey && !token && !isAuthenticating) {
      authenticate().catch(() => {});
    }
  }, [connected, publicKey, token, isAuthenticating, authenticate]);

  const handleSave = async () => {
    if (!token) return;

    const dto: { username?: string; email?: string | null; avatar?: string | null } = {};
    if (username !== profile?.username) dto.username = username;
    if (email !== (profile?.email ?? "")) dto.email = email || null;
    if (avatar !== (profile?.avatar ?? "")) dto.avatar = avatar || null;

    if (Object.keys(dto).length === 0) {
      toast.info("No changes to save");
      return;
    }

    try {
      await updateProfile.mutateAsync(dto);
      toast.success("Profile updated");
      setDirty(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Update failed";
      toast.error(msg);
    }
  };

  if (!connected) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="text-lg font-semibold">Profile</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Connect your wallet to view and edit your profile.
        </p>
      </div>
    );
  }

  if (isLoading || isAuthenticating) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">Loading profile...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <Card>
        <CardHeader>
          <h1 className="text-lg font-semibold">Profile</h1>
          <p className="text-xs text-muted-foreground">
            {publicKey?.toBase58()}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setDirty(true);
              }}
              placeholder="your_username"
              maxLength={32}
            />
            <p className="text-[11px] text-muted-foreground">
              3-32 characters. Letters, numbers, underscores, dashes, and dots.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email (optional)</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setDirty(true);
              }}
              placeholder="you@example.com"
              maxLength={255}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="avatar">Avatar URL (optional)</Label>
            <Input
              id="avatar"
              value={avatar}
              onChange={(e) => {
                setAvatar(e.target.value);
                setDirty(true);
              }}
              placeholder="https://..."
              maxLength={512}
            />
          </div>

          <Button
            className="w-full"
            onClick={handleSave}
            disabled={!dirty || updateProfile.isPending}
          >
            {updateProfile.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save Changes
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
