"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Loader2, Save, Settings2, Layers } from "lucide-react";
import { toast } from "sonner";
import { SettingsPresetsModal } from "./settings-presets-modal";

export interface SettingsPreset {
  id: string;
  name: string;
  isActive: boolean;
  feeCollectInterval: string;
  deadlineCheckInterval: string;
}

const FEE_INTERVAL_OPTIONS = [
  { value: "none", label: "None (disabled)" },
  { value: "6h", label: "Every 6 hours" },
  { value: "12h", label: "Every 12 hours" },
  { value: "24h", label: "Every 24 hours" },
  { value: "48h", label: "Every 48 hours" },
  { value: "72h", label: "Every 72 hours" },
] as const;

const DEADLINE_INTERVAL_OPTIONS = [
  { value: "30s", label: "Every 30 seconds" },
  { value: "1m", label: "Every 1 minute" },
  { value: "2m", label: "Every 2 minutes" },
  { value: "5m", label: "Every 5 minutes" },
  { value: "10m", label: "Every 10 minutes" },
] as const;

interface ProtocolSettingsProps {
  token: string | null;
}

export function ProtocolSettings({ token }: ProtocolSettingsProps) {
  const [settings, setSettings] = useState<SettingsPreset | null>(null);
  const [feeInterval, setFeeInterval] = useState("none");
  const [deadlineInterval, setDeadlineInterval] = useState("1m");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);

  const fetchSettings = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await api.get<SettingsPreset>("/settings", undefined, token);
      setSettings(data);
      setFeeInterval(data.feeCollectInterval);
      setDeadlineInterval(data.deadlineCheckInterval);
    } catch {
      toast.error("Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    try {
      const data = await api.patch<SettingsPreset>(
        "/settings",
        {
          feeCollectInterval: feeInterval,
          deadlineCheckInterval: deadlineInterval,
        },
        token,
      );
      setSettings(data);
      setFeeInterval(data.feeCollectInterval);
      setDeadlineInterval(data.deadlineCheckInterval);
      toast.success("Settings updated");
    } catch {
      toast.error("Failed to update settings");
    } finally {
      setSaving(false);
    }
  };

  const hasChanges =
    settings &&
    (feeInterval !== settings.feeCollectInterval ||
      deadlineInterval !== settings.deadlineCheckInterval);

  if (!token) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        Authenticate to manage protocol settings.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        <p>Failed to load settings.</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={fetchSettings}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-xl border border-border/40 bg-card/50 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Protocol Settings
            </h3>
          </div>
          {settings && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">
                Preset: <span className="font-medium text-foreground">{settings.name}</span>
              </span>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setPresetsOpen(true)}
              >
                <Layers className="h-3.5 w-3.5" />
                Manage Presets
              </Button>
            </div>
          )}
        </div>

        {feeInterval === "none" && (
          <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-[12px] text-amber-400">
            Automatic fee collection is disabled. Fees must be collected manually
            from the &ldquo;Collect Fees&rdquo; tab.
          </div>
        )}

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          {/* Fee Collection Interval */}
          <div>
            <label className="mb-1.5 block text-xs text-muted-foreground">
              Fee Collection Interval
            </label>
            <select
              value={feeInterval}
              onChange={(e) => setFeeInterval(e.target.value)}
              className="h-9 w-full rounded-md border border-border/60 bg-card px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            >
              {FEE_INTERVAL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              How often the backend sweeps accumulated fees to the treasury.
            </p>
          </div>

          {/* Deadline Check Interval */}
          <div>
            <label className="mb-1.5 block text-xs text-muted-foreground">
              Deadline Check Interval
            </label>
            <select
              value={deadlineInterval}
              onChange={(e) => setDeadlineInterval(e.target.value)}
              className="h-9 w-full rounded-md border border-border/60 bg-card px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            >
              {DEADLINE_INTERVAL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              How often the backend checks for expired markets to close.
            </p>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <Button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className="gap-2"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save Settings
          </Button>
        </div>
      </div>

      <SettingsPresetsModal
        open={presetsOpen}
        onOpenChange={setPresetsOpen}
        token={token}
        onPresetActivated={fetchSettings}
      />
    </>
  );
}
