"use client";

import { useFormContext } from "react-hook-form";
import { useWallet } from "@solana/wallet-adapter-react";
import type { CreateMarketFormData } from "@/lib/schemas/create-market-schema";
import { useTokenBalance } from "@/hooks/use-token-balance";
import { formatUsdc } from "@/lib/types";
import { Input } from "@/components/ui/input";

export function StepParameters() {
  const {
    register,
    watch,
    formState: { errors },
  } = useFormContext<CreateMarketFormData>();
  const { publicKey } = useWallet();
  const collateralMint = watch("collateralMint");
  const address = publicKey?.toBase58();

  // Show balance if valid mint is entered
  const { data: balance } = useTokenBalance(collateralMint, address);

  // Minimum datetime: now + 1 hour
  const minDatetime = new Date(Date.now() + 3600_000).toISOString().slice(0, 16);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Market Parameters</h2>
        <p className="text-sm text-muted-foreground">
          Configure deadline, oracle, and liquidity
        </p>
      </div>

      {/* Deadline */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Deadline *
        </label>
        <input
          type="datetime-local"
          {...register("deadline")}
          min={minDatetime}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:bg-input/30"
        />
        {errors.deadline && (
          <p className="mt-1 text-xs text-destructive">
            {errors.deadline.message}
          </p>
        )}
      </div>

      {/* Oracle */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Oracle Wallet *
        </label>
        <Input
          {...register("oracle")}
          placeholder="Oracle wallet address (must have Oracle role)"
          className="font-mono text-sm"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          The oracle must already have the Oracle role assigned on-chain
        </p>
        {errors.oracle && (
          <p className="mt-1 text-xs text-destructive">
            {errors.oracle.message}
          </p>
        )}
      </div>

      {/* Collateral Mint */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Collateral Mint *
        </label>
        <Input
          {...register("collateralMint")}
          placeholder="SPL token mint address (e.g. USDC)"
          className="font-mono text-sm"
        />
        {balance != null && balance > 0 && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Your balance: {formatUsdc(balance)}
          </p>
        )}
        {errors.collateralMint && (
          <p className="mt-1 text-xs text-destructive">
            {errors.collateralMint.message}
          </p>
        )}
      </div>

      {/* Initial Liquidity */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Initial Liquidity (USDC) *
        </label>
        <div className="relative">
          <Input
            type="number"
            {...register("initialLiquidity")}
            placeholder="10.00"
            min="1"
            step="0.01"
            className="pr-14"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            USDC
          </span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Minimum: 1 USDC
        </p>
        {errors.initialLiquidity && (
          <p className="mt-1 text-xs text-destructive">
            {errors.initialLiquidity.message}
          </p>
        )}
      </div>
    </div>
  );
}
