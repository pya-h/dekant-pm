"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Plus, Pencil, Trash2, Droplets } from "lucide-react";
import { toast } from "sonner";

interface FaucetConfig {
  id: string;
  token: string;
  label: string;
  amountPerRequest: string;
  maxRequestsPerDay: number;
  maxDailyAmount: string | null;
  totalAmountSharable: string | null;
  enabled: boolean;
  createdAt: string;
}

interface ConfigForm {
  token: string;
  label: string;
  amountPerRequest: string;
  maxRequestsPerDay: string;
  maxDailyAmount: string;
  totalAmountSharable: string;
  enabled: boolean;
}

const emptyForm: ConfigForm = {
  token: "",
  label: "",
  amountPerRequest: "",
  maxRequestsPerDay: "3",
  maxDailyAmount: "",
  totalAmountSharable: "",
  enabled: true,
};

export function FaucetManager({ token }: { token: string | null }) {
  const queryClient = useQueryClient();
  const { token: authToken, authenticate } = useAuth();
  const effectiveToken = token || authToken;

  const { data: configs, isLoading } = useQuery({
    queryKey: ["faucet-configs"],
    queryFn: () => api.get<FaucetConfig[]>("/faucet/configs"),
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ConfigForm>(emptyForm);

  const createMutation = useMutation({
    mutationFn: async (data: ConfigForm) => {
      let tk = effectiveToken;
      if (!tk) tk = await authenticate();
      return api.post("/faucet/configs", {
        token: data.token,
        label: data.label,
        amountPerRequest: data.amountPerRequest,
        maxRequestsPerDay: Number(data.maxRequestsPerDay),
        maxDailyAmount: data.maxDailyAmount || undefined,
        totalAmountSharable: data.totalAmountSharable || undefined,
        enabled: data.enabled,
      }, tk);
    },
    onSuccess: () => {
      toast.success("Faucet config created");
      queryClient.invalidateQueries({ queryKey: ["faucet-configs"] });
      setDialogOpen(false);
    },
    onError: (err: any) => toast.error(err?.message ?? "Failed to create config"),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ConfigForm> }) => {
      let tk = effectiveToken;
      if (!tk) tk = await authenticate();
      return api.patch(`/faucet/configs/${id}`, {
        label: data.label || undefined,
        amountPerRequest: data.amountPerRequest || undefined,
        maxRequestsPerDay: data.maxRequestsPerDay ? Number(data.maxRequestsPerDay) : undefined,
        maxDailyAmount: data.maxDailyAmount || null,
        totalAmountSharable: data.totalAmountSharable || null,
        enabled: data.enabled,
      }, tk);
    },
    onSuccess: () => {
      toast.success("Faucet config updated");
      queryClient.invalidateQueries({ queryKey: ["faucet-configs"] });
      setDialogOpen(false);
    },
    onError: (err: any) => toast.error(err?.message ?? "Failed to update config"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      let tk = effectiveToken;
      if (!tk) tk = await authenticate();
      return api.delete(`/faucet/configs/${id}`, tk);
    },
    onSuccess: () => {
      toast.success("Faucet config deleted");
      queryClient.invalidateQueries({ queryKey: ["faucet-configs"] });
    },
    onError: (err: any) => toast.error(err?.message ?? "Failed to delete config"),
  });

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (config: FaucetConfig) => {
    setEditingId(config.id);
    setForm({
      token: config.token,
      label: config.label,
      amountPerRequest: config.amountPerRequest,
      maxRequestsPerDay: String(config.maxRequestsPerDay),
      maxDailyAmount: config.maxDailyAmount ?? "",
      totalAmountSharable: config.totalAmountSharable ?? "",
      enabled: config.enabled,
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!form.token || !form.label || !form.amountPerRequest) {
      toast.error("Token, label, and amount per request are required");
      return;
    }
    if (editingId) {
      updateMutation.mutate({ id: editingId, data: form });
    } else {
      createMutation.mutate(form);
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Droplets className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Faucet Configurations</h2>
        </div>
        <Button onClick={openCreate} size="sm" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add Token
        </Button>
      </div>

      {!configs?.length ? (
        <div className="rounded-lg border border-border/40 bg-muted/10 p-8 text-center text-sm text-muted-foreground">
          No faucet configs yet. Add a token to enable faucet for users.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {configs.map((config) => (
            <Card key={config.id} className={!config.enabled ? "opacity-50" : ""}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">
                    {config.label}
                    {config.token === "native" && (
                      <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">(SOL)</span>
                    )}
                  </CardTitle>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => openEdit(config)}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => {
                        if (confirm(`Delete faucet config for "${config.label}"?`)) {
                          deleteMutation.mutate(config.id);
                        }
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>Token:</span>
                  <span className="font-mono truncate max-w-[140px]" title={config.token}>
                    {config.token === "native" ? "Native SOL" : config.token}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Per request:</span>
                  <span>{config.amountPerRequest}</span>
                </div>
                <div className="flex justify-between">
                  <span>Max/day (user):</span>
                  <span>{config.maxRequestsPerDay}</span>
                </div>
                {config.maxDailyAmount && (
                  <div className="flex justify-between">
                    <span>Daily cap (global):</span>
                    <span>{config.maxDailyAmount}</span>
                  </div>
                )}
                {config.totalAmountSharable && (
                  <div className="flex justify-between">
                    <span>Total cap:</span>
                    <span>{config.totalAmountSharable}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Status:</span>
                  <span className={config.enabled ? "text-emerald-400" : "text-rose-400"}>
                    {config.enabled ? "Active" : "Disabled"}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Faucet Config" : "Add Faucet Config"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Token (mint address or &quot;native&quot;)</label>
              <Input
                value={form.token}
                onChange={(e) => setForm({ ...form, token: e.target.value })}
                placeholder="native or mint address"
                disabled={!!editingId}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Label</label>
              <Input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="e.g. SOL, USDC"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Amount per request (smallest unit)</label>
              <Input
                value={form.amountPerRequest}
                onChange={(e) => setForm({ ...form, amountPerRequest: e.target.value })}
                placeholder="e.g. 1000000000 (= 1 SOL)"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Max requests per user per day</label>
              <Input
                type="number"
                value={form.maxRequestsPerDay}
                onChange={(e) => setForm({ ...form, maxRequestsPerDay: e.target.value })}
                placeholder="3"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Max daily amount (global, optional)</label>
              <Input
                value={form.maxDailyAmount}
                onChange={(e) => setForm({ ...form, maxDailyAmount: e.target.value })}
                placeholder="Leave empty for no limit"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Total amount sharable (lifetime, optional)</label>
              <Input
                value={form.totalAmountSharable}
                onChange={(e) => setForm({ ...form, totalAmountSharable: e.target.value })}
                placeholder="Leave empty for no limit"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="faucet-enabled"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                className="h-4 w-4"
              />
              <label htmlFor="faucet-enabled" className="text-sm">Enabled</label>
            </div>
            <Button
              onClick={handleSubmit}
              disabled={isSaving}
              className="w-full"
            >
              {isSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {editingId ? "Update" : "Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
