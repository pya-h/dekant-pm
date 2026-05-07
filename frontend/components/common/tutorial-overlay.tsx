"use client";

import { useEffect, useState, useCallback, useRef, useId } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { createPortal } from "react-dom";

export interface TutorialStep {
  /** data-tutorial attribute value on the target element */
  target: string;
  /** Text shown in the popover */
  title: string;
  /** Preferred popover placement relative to target */
  placement?: "top" | "bottom" | "left" | "right";
  /** Show spotlight cutout + dashed border around target (default true) */
  spotlight?: boolean;
}

interface TutorialOverlayProps {
  steps: TutorialStep[];
  currentStep: number;
  onAdvance: () => void;
  onGoBack: () => void;
  onDismiss: () => void;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PADDING = 8;
const POPOVER_GAP = 12;
const ANIM_DURATION = 350;

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

export function TutorialOverlay({
  steps,
  currentStep,
  onAdvance,
  onGoBack,
  onDismiss,
}: TutorialOverlayProps) {
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const [stepKey, setStepKey] = useState(currentStep);
  const [textVisible, setTextVisible] = useState(true);
  const popoverRef = useRef<HTMLDivElement>(null);
  const maskId = useId();

  // Animated rect for smooth spotlight movement
  const animatedRectRef = useRef<Rect | null>(null);
  const [displayRect, setDisplayRect] = useState<Rect | null>(null);
  const animFrameRef = useRef<number>(0);

  const step = steps[currentStep] ?? null;
  const targetSelector = step?.target ?? "";
  const placement = step?.placement ?? "bottom";
  const showSpotlight = step?.spotlight !== false;

  // Fade in on mount
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Crossfade step text when currentStep changes
  useEffect(() => {
    setTextVisible(false);
    const timer = setTimeout(() => {
      setStepKey(currentStep);
      setTextVisible(true);
    }, 150);
    return () => clearTimeout(timer);
  }, [currentStep]);

  // Measure target element (viewport-relative for fixed positioning)
  const measureTarget = useCallback(() => {
    if (!targetSelector) {
      setTargetRect(null);
      return;
    }
    const el = document.querySelector(`[data-tutorial="${targetSelector}"]`);
    if (!el) {
      setTargetRect(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    setTargetRect({
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    });
  }, [targetSelector]);

  // Measure on mount, scroll, and resize
  useEffect(() => {
    if (!step) return;
    measureTarget();
    window.addEventListener("scroll", measureTarget, true);
    window.addEventListener("resize", measureTarget);
    return () => {
      window.removeEventListener("scroll", measureTarget, true);
      window.removeEventListener("resize", measureTarget);
    };
  }, [measureTarget, step]);

  // Scroll target into view
  useEffect(() => {
    if (!targetSelector) return;
    const el = document.querySelector(`[data-tutorial="${targetSelector}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [targetSelector]);

  // Animate spotlight cutout toward target rect
  useEffect(() => {
    cancelAnimationFrame(animFrameRef.current);

    if (!targetRect) {
      animatedRectRef.current = null;
      setDisplayRect(null);
      return;
    }

    const startRect = animatedRectRef.current ?? targetRect;
    const startTime = performance.now();

    const animate = (now: number) => {
      const t = Math.min(1, (now - startTime) / ANIM_DURATION);
      const ease = easeOutCubic(t);
      const current: Rect = {
        top: startRect.top + (targetRect.top - startRect.top) * ease,
        left: startRect.left + (targetRect.left - startRect.left) * ease,
        width: startRect.width + (targetRect.width - startRect.width) * ease,
        height: startRect.height + (targetRect.height - startRect.height) * ease,
      };
      animatedRectRef.current = current;
      setDisplayRect(current);
      if (t < 1) animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [targetRect]);

  // Position popover (viewport-relative, fixed positioning)
  useEffect(() => {
    if (!step || !popoverRef.current) return;

    const popover = popoverRef.current;
    const pw = popover.offsetWidth;
    const ph = popover.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = 0;
    let left = 0;

    if (!targetRect) {
      top = vh / 2 - ph / 2;
      left = vw / 2 - pw / 2;
    } else {
      if (placement === "bottom") {
        top = targetRect.top + targetRect.height + PADDING + POPOVER_GAP;
        left = targetRect.left + targetRect.width / 2 - pw / 2;
      } else if (placement === "top") {
        top = targetRect.top - ph - PADDING - POPOVER_GAP;
        left = targetRect.left + targetRect.width / 2 - pw / 2;
      } else if (placement === "right") {
        top = targetRect.top + targetRect.height / 2 - ph / 2;
        left = targetRect.left + targetRect.width + PADDING + POPOVER_GAP;
      } else if (placement === "left") {
        top = targetRect.top + targetRect.height / 2 - ph / 2;
        left = targetRect.left - pw - PADDING - POPOVER_GAP;
      }
    }

    // Clamp to viewport
    if (left < 12) left = 12;
    if (left + pw > vw - 12) left = vw - pw - 12;
    if (top < 12) top = 12;
    if (top + ph > vh - 12) top = vh - ph - 12;

    setPopoverPos({ top, left });
  }, [targetRect, placement, step, currentStep]);

  // Keyboard navigation
  useEffect(() => {
    if (!step) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
      if (e.key === "ArrowRight" || e.key === "Enter") onAdvance();
      if (e.key === "ArrowLeft") onGoBack();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onAdvance, onGoBack, onDismiss, step]);

  if (!step) return null;

  const displayStep = steps[stepKey] ?? step;

  const overlay = (
    <div
      className="tutorial-overlay"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9998,
        opacity: mounted ? 1 : 0,
        transition: "opacity 300ms ease-out",
      }}
    >
      {/* Dimming layer with animated mask cutout */}
      <svg
        style={{ position: "fixed", inset: 0, width: "100%", height: "100%", zIndex: 9998, pointerEvents: "none" }}
      >
        <defs>
          <mask id={maskId}>
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {showSpotlight && displayRect && (
              <rect
                x={displayRect.left - PADDING}
                y={displayRect.top - PADDING}
                width={displayRect.width + PADDING * 2}
                height={displayRect.height + PADDING * 2}
                rx="8"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.6)"
          mask={`url(#${maskId})`}
        />
      </svg>

      {/* Click-capture layer */}
      <div
        style={{ position: "fixed", inset: 0, zIndex: 9998 }}
        onClick={onDismiss}
      />

      {/* Animated highlight border around target */}
      {showSpotlight && displayRect && (
        <div
          style={{
            position: "fixed",
            top: `${displayRect.top - PADDING}px`,
            left: `${displayRect.left - PADDING}px`,
            width: `${displayRect.width + PADDING * 2}px`,
            height: `${displayRect.height + PADDING * 2}px`,
            borderRadius: "8px",
            border: "2px dashed oklch(0.7 0.15 200)",
            zIndex: 9999,
            pointerEvents: "none",
          }}
        />
      )}

      {/* Popover with smooth position transitions */}
      <div
        ref={popoverRef}
        style={{
          position: "fixed",
          top: popoverPos ? `${popoverPos.top}px` : "50%",
          left: popoverPos ? `${popoverPos.left}px` : "50%",
          zIndex: 10000,
          transition: "top 350ms cubic-bezier(0.33, 1, 0.68, 1), left 350ms cubic-bezier(0.33, 1, 0.68, 1)",
          animation: "tutorial-popover-in 300ms cubic-bezier(0.33, 1, 0.68, 1) both",
        }}
        className="rounded-xl border border-[oklch(1_0_0/15%)] bg-[oklch(0.18_0.005_285)] shadow-2xl shadow-black/40"
        onClick={(e) => e.stopPropagation()}
      >
        <style>{`
          @keyframes tutorial-popover-in {
            from { opacity: 0; transform: scale(0.92) translateY(8px); }
            to   { opacity: 1; transform: scale(1) translateY(0); }
          }
        `}</style>
        <div className="flex items-start gap-3 p-4 min-w-[200px] max-w-[340px]">
          <div className="flex-1 min-w-0">
            <p
              className="text-sm font-medium text-[oklch(0.95_0_0)]"
              style={{
                opacity: textVisible ? 1 : 0,
                transform: textVisible ? "translateY(0)" : "translateY(-4px)",
                transition: "opacity 150ms ease, transform 150ms ease",
              }}
            >
              {displayStep.title}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={onGoBack}
                disabled={currentStep === 0}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-[oklch(1_0_0/15%)] text-[oklch(0.7_0_0)] transition-colors hover:bg-[oklch(1_0_0/8%)] hover:text-[oklch(0.9_0_0)] disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onAdvance}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-[oklch(1_0_0/15%)] text-[oklch(0.7_0_0)] transition-colors hover:bg-[oklch(1_0_0/8%)] hover:text-[oklch(0.9_0_0)]"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <span className="ml-1 text-xs tabular-nums text-[oklch(0.55_0_0)]">
                {currentStep + 1}/{steps.length}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-md text-[oklch(0.5_0_0)] transition-colors hover:bg-[oklch(1_0_0/8%)] hover:text-[oklch(0.8_0_0)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
