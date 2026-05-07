import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useTutorial, TUTORIAL_TOTAL_STEPS } from "@/hooks/use-tutorial";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockProfile = vi.fn<() => { data: any; isLoading: boolean }>();
const mockInvalidateQueries = vi.fn();
const mockApiPatch = vi.fn();

vi.mock("@/hooks/use-profile", () => ({
  useProfile: (...args: unknown[]) => mockProfile(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    patch: (...args: unknown[]) => mockApiPatch(...args),
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useTutorial", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProfile.mockReturnValue({ data: null, isLoading: false });
    mockApiPatch.mockResolvedValue({ tutorialStepSeen: 1 });
  });

  // ── Initial state ─────────────────────────────────────────────

  it("should be inactive when wallet is not connected", () => {
    const { result } = renderHook(() => useTutorial(null, false));

    expect(result.current.isActive).toBe(false);
    expect(result.current.currentStep).toBeNull();
  });

  it("should start at step 0 for unauthenticated connected wallet", () => {
    const { result } = renderHook(() => useTutorial(null, true));

    expect(result.current.isActive).toBe(true);
    expect(result.current.currentStep).toBe(0);
  });

  it("should sync from profile when authenticated", () => {
    mockProfile.mockReturnValue({
      data: { tutorialStepSeen: 2 },
      isLoading: false,
    });

    const { result } = renderHook(() => useTutorial("token-abc", true));

    expect(result.current.isActive).toBe(true);
    expect(result.current.currentStep).toBe(2);
  });

  it("should be inactive when profile shows tutorial completed", () => {
    mockProfile.mockReturnValue({
      data: { tutorialStepSeen: TUTORIAL_TOTAL_STEPS },
      isLoading: false,
    });

    const { result } = renderHook(() =>
      useTutorial("token-abc", true),
    );

    expect(result.current.isActive).toBe(false);
    expect(result.current.currentStep).toBeNull();
  });

  // ── Advance ───────────────────────────────────────────────────

  it("should advance step locally", async () => {
    const { result } = renderHook(() => useTutorial(null, true));
    expect(result.current.currentStep).toBe(0);

    await act(async () => {
      await result.current.advance();
    });

    expect(result.current.currentStep).toBe(1);
  });

  it("should skip persistence when not authenticated", async () => {
    const { result } = renderHook(() => useTutorial(null, true));

    await act(async () => {
      await result.current.advance();
    });

    expect(mockApiPatch).not.toHaveBeenCalled();
  });

  it("should persist step when authenticated", async () => {
    mockProfile.mockReturnValue({
      data: { tutorialStepSeen: 0 },
      isLoading: false,
    });

    const { result } = renderHook(() =>
      useTutorial("token-abc", true),
    );

    await act(async () => {
      await result.current.advance();
    });

    expect(mockApiPatch).toHaveBeenCalledWith(
      "/profile/tutorial",
      { step: 1 },
      "token-abc",
    );
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["profile"],
    });
  });

  it("should become inactive after advancing past last step", async () => {
    mockProfile.mockReturnValue({
      data: { tutorialStepSeen: TUTORIAL_TOTAL_STEPS - 1 },
      isLoading: false,
    });

    const { result } = renderHook(() =>
      useTutorial("token-abc", true),
    );
    expect(result.current.currentStep).toBe(TUTORIAL_TOTAL_STEPS - 1);

    await act(async () => {
      await result.current.advance();
    });

    expect(result.current.isActive).toBe(false);
    expect(result.current.currentStep).toBeNull();
  });

  // ── Go back ───────────────────────────────────────────────────

  it("should go back one step", async () => {
    mockProfile.mockReturnValue({
      data: { tutorialStepSeen: 2 },
      isLoading: false,
    });

    const { result } = renderHook(() =>
      useTutorial("token-abc", true),
    );
    expect(result.current.currentStep).toBe(2);

    act(() => {
      result.current.goBack();
    });

    expect(result.current.currentStep).toBe(1);
  });

  it("should not go back below step 0", () => {
    const { result } = renderHook(() => useTutorial(null, true));
    expect(result.current.currentStep).toBe(0);

    act(() => {
      result.current.goBack();
    });

    expect(result.current.currentStep).toBe(0);
  });

  it("should not persist goBack to backend", () => {
    mockProfile.mockReturnValue({
      data: { tutorialStepSeen: 2 },
      isLoading: false,
    });

    const { result } = renderHook(() =>
      useTutorial("token-abc", true),
    );

    act(() => {
      result.current.goBack();
    });

    expect(mockApiPatch).not.toHaveBeenCalled();
  });

  // ── Dismiss ───────────────────────────────────────────────────

  it("should dismiss tutorial and persist total steps", async () => {
    const { result } = renderHook(() => useTutorial("token-abc", true));

    await act(async () => {
      await result.current.dismiss();
    });

    expect(result.current.isActive).toBe(false);
    expect(result.current.currentStep).toBeNull();
    expect(mockApiPatch).toHaveBeenCalledWith(
      "/profile/tutorial",
      { step: TUTORIAL_TOTAL_STEPS },
      "token-abc",
    );
  });

  it("should dismiss without persistence when unauthenticated", async () => {
    const { result } = renderHook(() => useTutorial(null, true));

    await act(async () => {
      await result.current.dismiss();
    });

    expect(result.current.isActive).toBe(false);
    expect(mockApiPatch).not.toHaveBeenCalled();
  });

  // ── Constants ─────────────────────────────────────────────────

  it("should expose totalSteps constant", () => {
    const { result } = renderHook(() => useTutorial(null, false));
    expect(result.current.totalSteps).toBe(TUTORIAL_TOTAL_STEPS);
  });

  // ── Resilience ────────────────────────────────────────────────

  it("should handle API error gracefully during advance", async () => {
    mockProfile.mockReturnValue({
      data: { tutorialStepSeen: 0 },
      isLoading: false,
    });
    mockApiPatch.mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() =>
      useTutorial("token-abc", true),
    );

    // Should advance locally even though API fails
    await act(async () => {
      await result.current.advance();
    });

    expect(result.current.currentStep).toBe(1);
  });
});
