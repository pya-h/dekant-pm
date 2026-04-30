"use client";

import { useMemo } from "react";
import { useFormContext } from "react-hook-form";
import { useWallet } from "@solana/wallet-adapter-react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { CreateMarketFormData } from "@/lib/schemas/create-market-schema";
import { useTokenBalance } from "@/hooks/use-token-balance";
import { useWalletTokens } from "@/hooks/use-wallet-tokens";
import { useAdminRoles } from "@/hooks/use-admin-roles";
import type { OracleValidation } from "@/hooks/use-oracle-validation";
import type { MintValidation } from "@/hooks/use-mint-validation";
import { useAuth } from "@/hooks/use-auth";
import { formatUsdc, USDC_DECIMALS, Role } from "@/lib/types";
import { Input } from "@/components/ui/input";
import {
  AddressCombobox,
  type ComboboxOption,
} from "@/components/ui/address-combobox";
import { Loader2 } from "lucide-react";

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

interface StepParametersProps {
  oracleValidation: UseQueryResult<OracleValidation>;
  mintValidation: UseQueryResult<MintValidation>;
}

export function StepParameters({
  oracleValidation,
  mintValidation,
}: StepParametersProps) {
  const {
    register,
    watch,
    setValue,
    formState: { errors },
  } = useFormContext<CreateMarketFormData>();
  const { publicKey } = useWallet();
  const { token } = useAuth();

  const oracleValue = watch("oracle");
  const collateralMint = watch("collateralMint");
  const initialLiquidity = watch("initialLiquidity");
  const address = publicKey?.toBase58();

  // Show balance if valid mint is entered
  const { data: balance } = useTokenBalance(collateralMint, address);

  // Fetch oracle addresses from protocol roles (admin/superadmin only)
  const { data: roles, isLoading: rolesLoading } = useAdminRoles(token);

  const oracleOptions = useMemo<ComboboxOption[]>(() => {
    if (!roles) return [];
    const seen = new Set<string>();
    return roles
      .filter((r) => r.role === Role.Oracle)
      .filter((r) => {
        if (seen.has(r.userAddress)) return false;
        seen.add(r.userAddress);
        return true;
      })
      .map((r) => ({
        value: r.userAddress,
        label: `Oracle — ${truncateAddress(r.userAddress)}`,
        description: r.userAddress,
      }));
  }, [roles]);

  // Fetch user's SPL token accounts for collateral mint selection
  const { data: walletTokens, isLoading: tokensLoading } =
    useWalletTokens(address);

  const mintOptions = useMemo<ComboboxOption[]>(() => {
    if (!walletTokens) return [];
    return walletTokens.map((t) => ({
      value: t.mint,
      label: `${truncateAddress(t.mint)} — Balance: ${t.uiAmount.toLocaleString()}`,
      description: t.mint,
    }));
  }, [walletTokens]);

  // Minimum datetime: now + 1 hour
  const minDatetime = new Date(Date.now() + 3600_000)
    .toISOString()
    .slice(0, 16);

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
        <AddressCombobox
          value={oracleValue}
          onChange={(v) => setValue("oracle", v, { shouldValidate: true })}
          options={oracleOptions}
          isLoading={rolesLoading && !!token}
          placeholder="Oracle wallet address (must have Oracle role)"
        />
        {/* Async oracle role validation */}
        {oracleValue && oracleValidation.isLoading && (
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Verifying oracle role...
          </p>
        )}
        {oracleValidation.data?.valid === true && (
          <p className="mt-1 text-[11px] text-green-500">
            ✓ Oracle role verified on-chain
          </p>
        )}
        {oracleValidation.data?.valid === false && (
          <p className="mt-1 text-[11px] text-destructive">
            {oracleValidation.data.error}
          </p>
        )}
        {!oracleValue && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            The oracle must already have the Oracle role assigned on-chain
          </p>
        )}
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
        <AddressCombobox
          value={collateralMint}
          onChange={(v) =>
            setValue("collateralMint", v, { shouldValidate: true })
          }
          options={mintOptions}
          isLoading={tokensLoading}
          placeholder="SPL token mint address (e.g. USDC)"
        />
        {/* Async mint validation */}
        {collateralMint && mintValidation.isLoading && (
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Verifying token mint...
          </p>
        )}
        {mintValidation.data?.valid === true && (
          <p className="mt-1 text-[11px] text-green-500">
            ✓ Valid SPL token mint
          </p>
        )}
        {mintValidation.data?.valid === false && (
          <p className="mt-1 text-[11px] text-destructive">
            {mintValidation.data.error}
          </p>
        )}
        {/* Balance display with insufficient funds warning */}
        {balance != null && balance > 0 && (() => {
          const liquidityNum = parseFloat(initialLiquidity || "0");
          const balanceHuman = balance / 10 ** USDC_DECIMALS;
          const insufficient = liquidityNum > 0 && liquidityNum > balanceHuman;
          return (
            <>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Your balance: {formatUsdc(balance)}
              </p>
              {insufficient && (
                <p className="mt-1 text-[11px] text-amber-500">
                  Insufficient balance — you need {liquidityNum.toFixed(2)} but
                  have {balanceHuman.toFixed(2)}
                </p>
              )}
            </>
          );
        })()}
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
        <p className="mt-1 text-[11px] text-muted-foreground">Minimum: 1 USDC</p>
        {errors.initialLiquidity && (
          <p className="mt-1 text-xs text-destructive">
            {errors.initialLiquidity.message}
          </p>
        )}
      </div>
    </div>
  );
}
