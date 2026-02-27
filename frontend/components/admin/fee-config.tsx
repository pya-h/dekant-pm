"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useQueryClient } from "@tanstack/react-query";
import { useProgram } from "@/lib/solana";
import { useProtocolConfig } from "@/hooks/use-protocol-config";
import { executeUpdateFees } from "@/lib/admin-transactions";
import { showTradeSuccess, showTradeError } from "@/components/common/transaction-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Save } from "lucide-react";

interface FeeConfigProps {
  isSuperadmin: boolean;
}

interface FeeFields {
  creationFeeBps: string;
  tradeFeeBps: string;
  redemptionFeeBps: string;
  lpFeeShareBps: string;
}

const FEE_LABELS: Record<keyof FeeFields, { label: string; max: number }> = {
  creationFeeBps: { label: "Creation Fee", max: 5000 },
  tradeFeeBps: { label: "Trade Fee", max: 5000 },
  redemptionFeeBps: { label: "Redemption Fee", max: 5000 },
  lpFeeShareBps: { label: "LP Fee Share", max: 10000 },
};

export function FeeConfig({ isSuperadmin }: FeeConfigProps) {
  const program = useProgram();
  const { publicKey } = useWallet();
  const queryClient = useQueryClient();
  const { data: config, isLoading } = useProtocolConfig();

  const [fees, setFees] = useState<FeeFields>({
    creationFeeBps: "",
    tradeFeeBps: "",
    redemptionFeeBps: "",
    lpFeeShareBps: "",
  });
  const [updating, setUpdating] = useState(false);

  // Populate fields when config loads
  useEffect(() => {
    if (config) {
      setFees({
        creationFeeBps: String(config.creationFeeBps),
        tradeFeeBps: String(config.tradeFeeBps),
        redemptionFeeBps: String(config.redemptionFeeBps),
        lpFeeShareBps: String(config.lpFeeShareBps),
      });
    }
  }, [config]);

  const handleUpdate = async () => {
    if (!program || !publicKey) return;

    const parsed = {
      creationFeeBps: parseInt(fees.creationFeeBps, 10),
      tradeFeeBps: parseInt(fees.tradeFeeBps, 10),
      redemptionFeeBps: parseInt(fees.redemptionFeeBps, 10),
      lpFeeShareBps: parseInt(fees.lpFeeShareBps, 10),
    };

    // Validate
    for (const [key, value] of Object.entries(parsed)) {
      const { max, label } = FEE_LABELS[key as keyof FeeFields];
      if (isNaN(value) || value < 0 || value > max) {
        showTradeError(new Error(`${label} must be 0–${max} bps`));
        return;
      }
    }

    setUpdating(true);
    try {
      const sig = await executeUpdateFees(program, publicKey, parsed);
      showTradeSuccess(sig, "Fees updated");
      queryClient.invalidateQueries({ queryKey: ["protocolConfig"] });
    } catch (err) {
      showTradeError(err);
    } finally {
      setUpdating(false);
    }
  };

  const hasChanges =
    config &&
    (fees.creationFeeBps !== String(config.creationFeeBps) ||
      fees.tradeFeeBps !== String(config.tradeFeeBps) ||
      fees.redemptionFeeBps !== String(config.redemptionFeeBps) ||
      fees.lpFeeShareBps !== String(config.lpFeeShareBps));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/40 bg-card/50 p-5">
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Protocol Fees
      </h3>

      <div className="grid gap-4 sm:grid-cols-2">
        {(Object.keys(FEE_LABELS) as (keyof FeeFields)[]).map((key) => {
          const { label, max } = FEE_LABELS[key];
          return (
            <div key={key}>
              <label className="mb-1.5 block text-xs text-muted-foreground">
                {label} (0–{max} bps)
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={max}
                  value={fees[key]}
                  onChange={(e) =>
                    setFees((prev) => ({ ...prev, [key]: e.target.value }))
                  }
                  disabled={!isSuperadmin}
                  className="tabular-nums"
                />
                <span className="text-xs text-muted-foreground">bps</span>
              </div>
              {fees[key] && (
                <div className="mt-1 text-[11px] text-muted-foreground">
                  = {(parseInt(fees[key], 10) / 100).toFixed(2)}%
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex items-center justify-between">
        {config && (
          <div className="text-[11px] text-muted-foreground">
            Treasury: {truncateAddress(config.treasury.toBase58())}
          </div>
        )}
        <Button
          onClick={handleUpdate}
          disabled={updating || !hasChanges || !isSuperadmin || !program}
          className="gap-2"
        >
          {updating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Update Fees
        </Button>
      </div>
    </div>
  );
}

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}
