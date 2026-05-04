"use client";

import { useState } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useProgram } from "@/lib/solana";
import { executeCreateMarket } from "@/lib/admin-transactions";
import { api } from "@/lib/api";
import {
  showTradeSuccess,
  showTradeError,
} from "@/components/common/transaction-toast";
import {
  createMarketSchema,
  DEFAULT_VALUES,
  STEP_FIELDS,
  type CreateMarketFormData,
} from "@/lib/schemas/create-market-schema";
import { MarketType, SCALE, USDC_DECIMALS } from "@/lib/types";
import { useOracleValidation } from "@/hooks/use-oracle-validation";
import { useMintValidation } from "@/hooks/use-mint-validation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight, ArrowLeft, Rocket } from "lucide-react";

import { StepTypeSelection } from "./step-type-selection";
import { StepQuestionDetails } from "./step-question-details";
import { StepOutcomes } from "./step-outcomes";
import { StepParameters } from "./step-parameters";
import { StepReview } from "./step-review";

const STEPS = [
  { label: "Type", description: "Select market type" },
  { label: "Details", description: "Question & metadata" },
  { label: "Outcomes", description: "Define outcomes" },
  { label: "Parameters", description: "Deadline & liquidity" },
  { label: "Review", description: "Confirm & create" },
];

interface CreateMarketFormProps {
  token: string | null;
  isSuperadmin: boolean;
  isAdmin: boolean;
}

export function CreateMarketForm({
  token,
  isSuperadmin,
  isAdmin,
}: CreateMarketFormProps) {
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();
  const program = useProgram();
  const { publicKey } = useWallet();
  const { connection } = useConnection();

  const methods = useForm<CreateMarketFormData>({
    resolver: zodResolver(createMarketSchema),
    defaultValues: DEFAULT_VALUES,
    mode: "onTouched",
  });

  const { trigger, handleSubmit, watch, setError } = methods;
  const marketType = watch("marketType");

  // Async address validation (oracle role + mint account)
  const oracleValue = watch("oracle");
  const mintValue = watch("collateralMint");
  const oracleValidation = useOracleValidation(oracleValue);
  const mintValidation = useMintValidation(mintValue);

  const handleNext = async () => {
    const fields = STEP_FIELDS[step];
    const valid = fields.length === 0 || (await trigger(fields));
    if (!valid) return;

    // On step 3 (Parameters), block progression if async validation fails
    if (step === 3) {
      if (oracleValidation.isLoading || mintValidation.isLoading) return;

      if (oracleValidation.data && !oracleValidation.data.valid) {
        setError("oracle", { message: oracleValidation.data.error! });
        return;
      }
      if (mintValidation.data && !mintValidation.data.valid) {
        setError("collateralMint", { message: mintValidation.data.error! });
        return;
      }
    }

    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const handleBack = () => setStep((s) => Math.max(s - 1, 0));

  const onSubmit = async (data: CreateMarketFormData) => {
    if (!program || !publicKey || !token) return;
    setSubmitting(true);

    try {
      // Build on-chain params
      const oracle = new PublicKey(data.oracle);
      const collateralMint = new PublicKey(data.collateralMint);
      const deadlineUnix = Math.floor(
        new Date(data.deadline).getTime() / 1000,
      );
      const liquidityBN = toBaseUnits(data.initialLiquidity);

      let numOutcomes: number;
      let rangeMin = new BN(0);
      let rangeMax = new BN(0);

      if (data.marketType === MarketType.Binary) {
        numOutcomes = 2;
      } else if (data.marketType === MarketType.MultiOutcome) {
        numOutcomes = data.outcomeLabels?.filter((l) => l.trim()).length ?? 3;
      } else {
        numOutcomes = data.numBins ?? 64;
        rangeMin = new BN(Math.round((data.rangeMin ?? 0) * SCALE));
        rangeMax = new BN(Math.round((data.rangeMax ?? 0) * SCALE));
      }

      // Send on-chain transaction
      const result = await executeCreateMarket(program, publicKey, {
        marketType: data.marketType,
        numOutcomes,
        deadline: deadlineUnix,
        oracle,
        collateralMint,
        initialLiquidity: liquidityBN,
        rangeMin,
        rangeMax,
        isSuperadmin,
        isAdmin,
      });

      // Wait for confirmation to prevent wallet hanging on next operation
      try {
        const latestBlockhash = await connection.getLatestBlockhash();
        await connection.confirmTransaction(
          { signature: result.signature, ...latestBlockhash },
          "confirmed",
        );
      } catch {
        // Confirmation timeout is non-fatal
      }

      showTradeSuccess(result.signature, "Market created");

      // POST metadata to backend
      const dto = {
        marketId: result.marketId,
        pubkey: result.marketPubkey.toBase58(),
        marketType: data.marketType,
        numOutcomes,
        creator: publicKey.toBase58(),
        oracle: data.oracle,
        collateralMint: data.collateralMint,
        deadline: new Date(data.deadline).toISOString(),
        title: data.title,
        description: data.description || undefined,
        category: data.category || undefined,
        subject: data.subject || undefined,
        tags: data.tags?.length ? data.tags : undefined,
        outcomeLabels:
          data.marketType === MarketType.Binary
            ? ["Yes", "No"]
            : data.marketType === MarketType.MultiOutcome
              ? data.outcomeLabels?.filter((l) => l.trim())
              : undefined,
        ...(data.marketType === MarketType.Continuous && {
          rangeMin: Math.round((data.rangeMin ?? 0) * SCALE),
          rangeMax: Math.round((data.rangeMax ?? 0) * SCALE),
        }),
      };

      await api.post("/markets", dto, token);

      // Redirect to new market
      router.push(`/markets/${result.marketId}`);
    } catch (error) {
      showTradeError(error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormProvider {...methods}>
      <form onSubmit={handleSubmit(onSubmit)}>
        {/* Step indicator */}
        <StepIndicator steps={STEPS} currentStep={step} />

        {/* Step content */}
        <div className="mt-6 rounded-xl border border-border/40 bg-card/50 p-5 sm:p-6">
          {step === 0 && <StepTypeSelection />}
          {step === 1 && <StepQuestionDetails />}
          {step === 2 && <StepOutcomes marketType={marketType} />}
          {step === 3 && (
            <StepParameters
              oracleValidation={oracleValidation}
              mintValidation={mintValidation}
            />
          )}
          {step === 4 && <StepReview />}
        </div>

        {/* Navigation */}
        <div className="mt-6 flex items-center justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={handleBack}
            disabled={step === 0}
            className="gap-1.5"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>

          {step < STEPS.length - 1 ? (
            <Button
              type="button"
              onClick={handleNext}
              className="gap-1.5"
            >
              Next
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="submit"
              disabled={submitting || !token}
              className="gap-1.5"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Rocket className="h-4 w-4" />
              )}
              {submitting ? "Creating..." : "Create Market"}
            </Button>
          )}
        </div>
      </form>
    </FormProvider>
  );
}

/** Human-readable amount -> token base units (6 decimals for USDC). */
function toBaseUnits(amount: string): BN {
  const trimmed = amount.trim();
  const [whole = "0", frac = ""] = trimmed.split(".");
  const padded = (frac + "000000").slice(0, USDC_DECIMALS);
  return new BN(whole + padded);
}

function StepIndicator({
  steps,
  currentStep,
}: {
  steps: typeof STEPS;
  currentStep: number;
}) {
  return (
    <div className="flex items-center">
      {steps.map((s, i) => (
        <div key={i} className="flex flex-1 items-center">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors",
                i < currentStep
                  ? "bg-primary text-primary-foreground"
                  : i === currentStep
                    ? "border-2 border-primary text-primary"
                    : "border border-border text-muted-foreground",
              )}
            >
              {i < currentStep ? "\u2713" : i + 1}
            </div>
            <span
              className={cn(
                "hidden text-xs sm:block",
                i <= currentStep
                  ? "text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={cn(
                "mx-2 h-px flex-1",
                i < currentStep ? "bg-primary" : "bg-border",
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}
