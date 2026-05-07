"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useProfile } from "./use-profile";
import { api } from "@/lib/api";

export const TUTORIAL_TOTAL_STEPS = 5;

/**
 * Database-driven tutorial hook.
 *
 * Reads tutorial progress from `profile.tutorialStepSeen` (backend DB).
 * On each step advance, calls PATCH /profile/tutorial to persist progress
 * if the user is already authenticated. Never forces wallet signature.
 */
export function useTutorial(
  token: string | null,
  walletConnected: boolean,
) {
  const { data: profile } = useProfile(token);
  const queryClient = useQueryClient();

  const [currentStep, setCurrentStep] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  // Guard to prevent profile re-sync from overriding optimistic local state
  // during the brief window between advance() and the profile refetch completing.
  const advancingRef = useRef(false);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  // Sync from profile (database is the source of truth)
  useEffect(() => {
    if (dismissed || advancingRef.current) return;

    if (!walletConnected) {
      setCurrentStep(null);
      return;
    }

    if (profile) {
      // Authenticated — use DB value
      const step = profile.tutorialStepSeen;
      setCurrentStep(step >= TUTORIAL_TOTAL_STEPS ? null : step);
    } else if (!token) {
      // Not yet authenticated — show tutorial from step 0 so new users
      // see the onboarding.
      setCurrentStep(0);
    }
  }, [profile, token, walletConnected, dismissed]);

  const persistStep = useCallback(
    async (step: number) => {
      const authToken = tokenRef.current;
      if (!authToken) {
        // Not authenticated — skip persistence, tutorial advances locally only
        advancingRef.current = false;
        return;
      }
      try {
        await api.patch<{ tutorialStepSeen: number }>(
          "/profile/tutorial",
          { step },
          authToken,
        );
        queryClient.invalidateQueries({ queryKey: ["profile"] });
      } catch {
        // Non-critical — UI already advanced optimistically
      } finally {
        advancingRef.current = false;
      }
    },
    [queryClient],
  );

  const advance = useCallback(async () => {
    if (currentStep === null) return;
    advancingRef.current = true;
    const nextStep = currentStep + 1;
    setCurrentStep(nextStep >= TUTORIAL_TOTAL_STEPS ? null : nextStep);
    await persistStep(nextStep);
  }, [currentStep, persistStep]);

  const goBack = useCallback(() => {
    if (currentStep === null || currentStep <= 0) return;
    setCurrentStep(currentStep - 1);
    // Don't persist going back — backend only stores max step seen
  }, [currentStep]);

  const dismiss = useCallback(async () => {
    setCurrentStep(null);
    setDismissed(true);
    advancingRef.current = true;
    await persistStep(TUTORIAL_TOTAL_STEPS);
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
