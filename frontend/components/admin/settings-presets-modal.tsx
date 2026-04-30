"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import type { SettingsPreset } from "./protocol-settings";

interface SettingsPresetsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  onPresetActivated: () => void;
}

export function SettingsPresetsModal({
  open,
  onOpenChange,
  token,
  onPresetActivated,
}: SettingsPresetsModalProps) {
  const [presets, setPresets] = useState<SettingsPreset[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<number | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFeeInterval, setNewFeeInterval] = useState("none");
  const [newDeadlineInterval, setNewDeadlineInterval] = useState("1m");
  const [creating, setCreating] = useState(false);

  const fetchPresets = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<SettingsPreset[]>(
        "/settings/all",
        undefined,
        token,
      );
      setPresets(data);
    } catch {
      toast.error("Failed to load presets");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (open) {
      fetchPresets();
      setShowCreate(false);
      setNewName("");
      setNewFeeInterval("none");
      setNewDeadlineInterval("1m");
    }
  }, [open, fetchPresets]);

  const handleActivate = async (id: number) => {
    setActionId(id);
    try {
      await api.post<SettingsPreset>(
        `/settings/${id}/activate`,
        {},
        token,
      );
      toast.success("Preset activated");
      await fetchPresets();
      onPresetActivated();
    } catch {
      toast.error("Failed to activate preset");
    } finally {
      setActionId(null);
    }
  };

  const handleDelete = async (id: number) => {
    setActionId(id);
    try {
      await api.delete<{ deleted: boolean }>(`/settings/${id}`, token);
      toast.success("Preset deleted");
      setPresets((prev) => prev.filter((p) => p.id !== id));
    } catch {
      toast.error("Failed to delete preset");
    } finally {
      setActionId(null);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const created = await api.post<SettingsPreset>(
        "/settings",
        {
          name: newName.trim(),
          feeCollectInterval: newFeeInterval,
          deadlineCheckInterval: newDeadlineInterval,
        },
        token,
      );
      setPresets((prev) => [...prev, created]);
      setNewName("");
      setNewFeeInterval("none");
      setNewDeadlineInterval("1m");
      setShowCreate(false);
      toast.success(`Preset "${created.name}" created`);
    } catch {
      toast.error("Failed to create preset");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings Presets</DialogTitle>
          <DialogDescription>
            Create and switch between saved configurations.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2">
            {presets.map((preset) => {
              const isActive = preset.isActive;
              const isProcessing = actionId === preset.id;

              return (
                <div
                  key={preset.id}
                  className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${
                    isActive
                      ? "border-primary/40 bg-primary/5"
                      : "border-border/40"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {preset.name}
                      </span>
                      {isActive && (
                        <Badge variant="default" className="text-[10px]">
                          Active
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      Fee: {preset.feeCollectInterval} &middot; Deadline:{" "}
                      {preset.deadlineCheckInterval}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {!isActive && (
                      <>
                        <Button
                          variant="outline"
                          size="xs"
                          className="gap-1"
                          onClick={() => handleActivate(preset.id)}
                          disabled={isProcessing}
                        >
                          {isProcessing ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Zap className="h-3 w-3" />
                          )}
                          Activate
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => handleDelete(preset.id)}
                          disabled={isProcessing}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          {isProcessing ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}

            {presets.length === 0 && (
              <div className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">
                No presets found
              </div>
            )}
          </div>
        )}

        {/* Create new preset */}
        {showCreate ? (
          <div className="space-y-3 rounded-lg border border-border/40 p-3">
            <Input
              placeholder="Preset name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              disabled={creating}
              autoFocus
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">
                  Fee Collection
                </label>
                <select
                  value={newFeeInterval}
                  onChange={(e) => setNewFeeInterval(e.target.value)}
                  disabled={creating}
                  className="h-8 w-full rounded-md border border-border/60 bg-card px-2 text-xs text-foreground outline-none focus:border-primary"
                >
                  <option value="none">None</option>
                  <option value="6h">Every 6h</option>
                  <option value="12h">Every 12h</option>
                  <option value="24h">Every 24h</option>
                  <option value="48h">Every 48h</option>
                  <option value="72h">Every 72h</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">
                  Deadline Check
                </label>
                <select
                  value={newDeadlineInterval}
                  onChange={(e) => setNewDeadlineInterval(e.target.value)}
                  disabled={creating}
                  className="h-8 w-full rounded-md border border-border/60 bg-card px-2 text-xs text-foreground outline-none focus:border-primary"
                >
                  <option value="30s">30s</option>
                  <option value="1m">1m</option>
                  <option value="2m">2m</option>
                  <option value="5m">5m</option>
                  <option value="10m">10m</option>
                </select>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowCreate(false);
                  setNewName("");
                  setNewFeeInterval("none");
                  setNewDeadlineInterval("1m");
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
              >
                {creating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  "Create"
                )}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setShowCreate(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            New Preset
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
