"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { MarketSummary } from "@/lib/types";
import { Loader2 } from "lucide-react";

interface EditMarketModalProps {
  market: MarketSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  onSuccess?: () => void;
}

export function EditMarketModal({
  market,
  open,
  onOpenChange,
  token,
  onSuccess,
}: EditMarketModalProps) {
  const [category, setCategory] = useState(market.category ?? "");
  const [subject, setSubject] = useState(market.subject ?? "");
  const [icon, setIcon] = useState(market.icon ?? "");
  const [tagsInput, setTagsInput] = useState(market.tags?.join(", ") ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (category.trim() !== (market.category ?? ""))
        body.category = category.trim();
      if (subject.trim() !== (market.subject ?? ""))
        body.subject = subject.trim();
      if (icon.trim() !== (market.icon ?? ""))
        body.icon = icon.trim() || null;
      const newTags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const oldTags = market.tags ?? [];
      if (JSON.stringify(newTags) !== JSON.stringify(oldTags))
        body.tags = newTags.length > 0 ? newTags : null;

      if (Object.keys(body).length === 0) {
        onOpenChange(false);
        return;
      }

      await api.patch(`/markets/${market.id}`, body, token);
      onSuccess?.();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Market</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground truncate">
            {market.title}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="edit-category">Category</Label>
            <Input
              id="edit-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="crypto"
              maxLength={64}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-subject">Subject</Label>
            <Input
              id="edit-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="BTC"
              maxLength={32}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-icon">Icon URL</Label>
            <Input
              id="edit-icon"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="https://... or leave blank to clear"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-tags">Tags (comma-separated)</Label>
            <Input
              id="edit-tags"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="defi, prediction, ..."
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
