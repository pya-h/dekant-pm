"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { useWalletTokens } from "@/hooks/use-wallet-tokens";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Plus, Pencil, Trash2, Droplets, ChevronDown } from "lucide-react";
import { toast } from "sonner";

const METAPLEX_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

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

interface TokenSuggestion {
  mint: string;
  symbol: string;
  name: string;
  uiAmount: number;
  decimals: number;
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

/** Parse token name and symbol from Metaplex metadata account data */
function parseMetaplexMetadata(data: Buffer): { name: string; symbol: string } | null {
  try {
    // key(1) + update_authority(32) + mint(32) = 65 bytes offset to name
    let offset = 65;
    if (data.length < offset + 4) return null;

    const nameLen = data.readUInt32LE(offset);
    offset += 4;
    if (data.length < offset + nameLen) return null;
    const name = data.subarray(offset, offset + nameLen).toString("utf-8").replace(/\0/g, "").trim();
    offset += nameLen;

    if (data.length < offset + 4) return null;
    const symbolLen = data.readUInt32LE(offset);
    offset += 4;
    if (data.length < offset + symbolLen) return null;
    const symbol = data.subarray(offset, offset + symbolLen).toString("utf-8").replace(/\0/g, "").trim();

    return { name, symbol };
  } catch {
    return null;
  }
}

function getMetadataPda(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      METAPLEX_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    METAPLEX_METADATA_PROGRAM_ID,
  );
  return pda;
}

export function FaucetManager({ token }: { token: string | null }) {
  const queryClient = useQueryClient();
  const { token: authToken, authenticate } = useAuth();
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const effectiveToken = token || authToken;
  const walletAddress = publicKey?.toBase58();

  const { data: configs, isLoading } = useQuery({
    queryKey: ["faucet-configs"],
    queryFn: () => api.get<FaucetConfig[]>("/faucet/configs", undefined, effectiveToken ?? undefined),
    enabled: !!effectiveToken,
  });

  const { data: walletTokens } = useWalletTokens(walletAddress);

  // Fetch metadata for all wallet tokens
  const { data: tokenSuggestions } = useQuery<TokenSuggestion[]>({
    queryKey: ["faucet-token-suggestions", walletAddress, walletTokens?.map((t) => t.mint).join(",")],
    queryFn: async () => {
      if (!walletTokens?.length) return [];

      const metadataPdas = walletTokens.map((t) =>
        getMetadataPda(new PublicKey(t.mint)),
      );

      const accounts = await connection.getMultipleAccountsInfo(metadataPdas);

      return walletTokens.map((t, i) => {
        const metaAccount = accounts[i];
        let symbol = "";
        let name = "";
        if (metaAccount?.data) {
          const parsed = parseMetaplexMetadata(Buffer.from(metaAccount.data));
          if (parsed) {
            symbol = parsed.symbol;
            name = parsed.name;
          }
        }
        return {
          mint: t.mint,
          symbol,
          name,
          uiAmount: t.uiAmount,
          decimals: t.decimals,
        };
      });
    },
    enabled: !!walletTokens?.length,
    staleTime: 60_000,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ConfigForm>(emptyForm);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const tokenInputRef = useRef<HTMLInputElement>(null);

  // Close suggestions on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        tokenInputRef.current &&
        !tokenInputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filteredSuggestions = useMemo(() => {
    const suggestions: TokenSuggestion[] = [];
    // Add native SOL option
    suggestions.push({
      mint: "native",
      symbol: "SOL",
      name: "Native SOL",
      uiAmount: -1, // will be fetched separately or shown without balance
      decimals: 9,
    });
    if (tokenSuggestions) {
      suggestions.push(...tokenSuggestions);
    }
    // Filter by form.token input
    const query = form.token.toLowerCase();
    if (!query) return suggestions;
    return suggestions.filter(
      (s) =>
        s.mint.toLowerCase().includes(query) ||
        s.symbol.toLowerCase().includes(query) ||
        s.name.toLowerCase().includes(query),
    );
  }, [tokenSuggestions, form.token]);

  const selectSuggestion = (s: TokenSuggestion) => {
    setForm({
      ...form,
      token: s.mint,
      label: s.symbol || s.name || "",
    });
    setShowSuggestions(false);
  };

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
    setShowSuggestions(false);
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
    setShowSuggestions(false);
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
            {/* Token field with suggestions */}
            <div className="relative">
              <label className="text-xs text-muted-foreground">Token (mint address or &quot;native&quot;)</label>
              <div className="relative">
                <Input
                  ref={tokenInputRef}
                  value={form.token}
                  onChange={(e) => {
                    setForm({ ...form, token: e.target.value });
                    if (!editingId) setShowSuggestions(true);
                  }}
                  onFocus={() => { if (!editingId) setShowSuggestions(true); }}
                  placeholder="native or mint address"
                  disabled={!!editingId}
                />
                {!editingId && (
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowSuggestions(!showSuggestions)}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                )}
              </div>
              {showSuggestions && !editingId && filteredSuggestions.length > 0 && (
                <div
                  ref={suggestionsRef}
                  className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-lg"
                >
                  {filteredSuggestions.map((s) => (
                    <button
                      key={s.mint}
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
                      onClick={() => selectSuggestion(s)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {s.symbol && (
                            <span className="font-semibold text-foreground">{s.symbol}</span>
                          )}
                          {s.name && s.name !== s.symbol && (
                            <span className="text-muted-foreground text-xs truncate">{s.name}</span>
                          )}
                        </div>
                        <div className="font-mono text-[10px] text-muted-foreground truncate">
                          {s.mint === "native" ? "Native SOL transfer" : s.mint}
                        </div>
                      </div>
                      {s.uiAmount >= 0 && (
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {s.uiAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
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
