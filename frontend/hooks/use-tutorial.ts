"use client";

import { useState, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export const TUTORIAL_TOTAL_STEPS = 5;

/**
 * Database-driven tutorial hook.
 *
 * Uses public `/users/:address/tutorial` endpoints — no JWT required.
 * Reads tutorial progress on mount, persists each advance fire-and-forget.
 * Works immediately when the wallet is connected, no signing needed.
 */
export function useTutorial(walletAddress: string | undefined) {
  const queryClient = useQueryClient();

  const { data: tutorialData } = useQuery({
    queryKey: ["tutorial", walletAddress],
    queryFn: () =>
      api.get<{ tutorialStepSeen: number }>(
        `/users/${walletAddress}/tutorial`,
      ),
    enabled: !!walletAddress,
  });

  const [dismissed, setDismissed] = useState(false);
  // undefined = no local override (use DB value); null = completed; number = active step
  const [localStep, setLocalStep] = useState<number | null | undefined>(undefined);

  // Reset local state when wallet changes (adjust-during-render pattern)
  const [prevWallet, setPrevWallet] = useState(walletAddress);
  if (walletAddress !== prevWallet) {
    setPrevWallet(walletAddress);
    setLocalStep(undefined);
    setDismissed(false);
  }

  // Derive the step from DB data (no effect needed)
  const dbStep = useMemo((): number | null => {
    if (!walletAddress) return null;
    if (tutorialData) {
      const step = tutorialData.tutorialStepSeen;
      return step >= TUTORIAL_TOTAL_STEPS ? null : step;
    }
    return 0;
  }, [walletAddress, tutorialData]);

  // Local override wins when set, otherwise fall back to DB-derived step
  const currentStep = dismissed || !walletAddress
    ? null
    : (localStep !== undefined ? localStep : dbStep);

  const persistStep = useCallback(
    (step: number) => {
      if (!walletAddress) return;
      api
        .patch<{ tutorialStepSeen: number }>(
          `/users/${walletAddress}/tutorial`,
          { step },
        )
        .then(() =>
          queryClient.invalidateQueries({ queryKey: ["tutorial", walletAddress] }),
        )
        .catch(() => {});
    },
    [queryClient, walletAddress],
  );

  const advance = useCallback(() => {
    if (currentStep === null) return;
    const nextStep = currentStep + 1;
    setLocalStep(nextStep >= TUTORIAL_TOTAL_STEPS ? null : nextStep);
    persistStep(nextStep);
  }, [currentStep, persistStep]);

  const goBack = useCallback(() => {
    if (currentStep === null || currentStep <= 0) return;
    setLocalStep(currentStep - 1);
  }, [currentStep]);

  const dismiss = useCallback(() => {
    setLocalStep(null);
    setDismissed(true);
    persistStep(TUTORIAL_TOTAL_STEPS);
  }, [persistStep]);

  const isActive = currentStep !== null && !dismissed;

  return {
    currentStep,
    totalSteps: TUTORIAL_TOTAL_STEPS,
    isActive,
    advance,
    goBack,
    dismiss,
  };
}
