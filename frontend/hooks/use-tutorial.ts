"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useProfile } from "./use-profile";
import { api } from "@/lib/api";

export const TUTORIAL_TOTAL_STEPS = 5;
const LS_KEY = "dekant_tutorial_step";

function getLocalStep(): number {
  if (typeof window === "undefined") return 0;
  const v = localStorage.getItem(LS_KEY);
  return v ? parseInt(v, 10) || 0 : 0;
}

function setLocalStep(step: number) {
  if (typeof window === "undefined") return;
  localStorage.setItem(LS_KEY, String(step));
}

export function useTutorial(token: string | null) {
  const { data: profile } = useProfile(token);
  const [currentStep, setCurrentStep] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const initializedRef = useRef(false);

  // Initialize from localStorage immediately, then sync from backend profile
  useEffect(() => {
    if (dismissed) return;

    // Determine the highest step seen
    const localStep = getLocalStep();
    const backendStep = profile?.tutorialStepSeen ?? 0;
    const maxStep = Math.max(localStep, backendStep);

    if (maxStep >= TUTORIAL_TOTAL_STEPS) {
      setCurrentStep(null);
      setLocalStep(TUTORIAL_TOTAL_STEPS);
      return;
    }

    // Only set from backend/localStorage on initial load, not on every profile re-fetch
    if (!initializedRef.current || (profile && backendStep > localStep)) {
      setCurrentStep(maxStep);
      setLocalStep(maxStep);
      initializedRef.current = true;
    }
  }, [profile, dismissed]);

  const persistStep = useCallback(
    async (step: number) => {
      setLocalStep(step);
      if (!token) return;
      try {
        await api.patch<{ tutorialStepSeen: number }>(
          "/profile/tutorial",
          { step },
          token,
        );
      } catch {
        // Non-critical
      }
    },
    [token],
  );

  const advance = useCallback(async () => {
    if (currentStep === null) return;
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
