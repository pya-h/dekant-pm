import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTutorial, TUTORIAL_TOTAL_STEPS } from "@/hooks/use-tutorial";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockTutorialQuery = vi.fn<() => { data: any; isLoading: boolean }>();
const mockInvalidateQueries = vi.fn();
const mockApiGet = vi.fn();
const mockApiPatch = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: any) => mockTutorialQuery(),
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    patch: (...args: unknown[]) => mockApiPatch(...args),
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const WALLET = "WaLLet111111111111111111111111111111111111111";

describe("useTutorial", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTutorialQuery.mockReturnValue({ data: null, isLoading: false });
    mockApiPatch.mockResolvedValue({ tutorialStepSeen: 1 });
  });

  // ── Initial state ─────────────────────────────────────────────

  it("should be inactive when wallet is not connected", () => {
    const { result } = renderHook(() => useTutorial(undefined));

    expect(result.current.isActive).toBe(false);
    expect(result.current.currentStep).toBeNull();
  });

  it("should start at step 0 for connected wallet with no DB data", () => {
    const { result } = renderHook(() => useTutorial(WALLET));

    expect(result.current.isActive).toBe(true);
    expect(result.current.currentStep).toBe(0);
  });

  it("should sync from backend tutorial data", () => {
    mockTutorialQuery.mockReturnValue({
      data: { tutorialStepSeen: 2 },
      isLoading: false,
    });

    const { result } = renderHook(() => useTutorial(WALLET));

    expect(result.current.isActive).toBe(true);
    expect(result.current.currentStep).toBe(2);
  });

  it("should be inactive when tutorial is completed in DB", () => {
    mockTutorialQuery.mockReturnValue({
      data: { tutorialStepSeen: TUTORIAL_TOTAL_STEPS },
      isLoading: false,
    });

    const { result } = renderHook(() => useTutorial(WALLET));

    expect(result.current.isActive).toBe(false);
    expect(result.current.currentStep).toBeNull();
  });

  // ── Advance ───────────────────────────────────────────────────

  it("should advance step locally", () => {
    const { result } = renderHook(() => useTutorial(WALLET));
    expect(result.current.currentStep).toBe(0);

    act(() => {
      result.current.advance();
    });

    expect(result.current.currentStep).toBe(1);
  });

  it("should persist step via public endpoint (no JWT needed)", async () => {
    mockTutorialQuery.mockReturnValue({
      data: { tutorialStepSeen: 0 },
      isLoading: false,
    });

    const { result } = renderHook(() => useTutorial(WALLET));

    await act(async () => {
      result.current.advance();
      await vi.waitFor(() => expect(mockApiPatch).toHaveBeenCalled());
    });

    expect(mockApiPatch).toHaveBeenCalledWith(
      `/users/${WALLET}/tutorial`,
      { step: 1 },
    );
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["tutorial", WALLET],
    });
  });

  it("should not persist when wallet address is undefined", () => {
    mockTutorialQuery.mockReturnValue({ data: null, isLoading: false });

    // No wallet address — hook should not call API
    const { result } = renderHook(() => useTutorial(undefined));

    // Not active without a wallet
    expect(result.current.isActive).toBe(false);
    expect(mockApiPatch).not.toHaveBeenCalled();
  });

  it("should become inactive after advancing past last step", () => {
    mockTutorialQuery.mockReturnValue({
      data: { tutorialStepSeen: TUTORIAL_TOTAL_STEPS - 1 },
      isLoading: false,
    });

    const { result } = renderHook(() => useTutorial(WALLET));
    expect(result.current.currentStep).toBe(TUTORIAL_TOTAL_STEPS - 1);

    act(() => {
      result.current.advance();
    });

    expect(result.current.isActive).toBe(false);
    expect(result.current.currentStep).toBeNull();
  });

  // ── Go back ───────────────────────────────────────────────────

  it("should go back one step", () => {
    mockTutorialQuery.mockReturnValue({
      data: { tutorialStepSeen: 2 },
      isLoading: false,
    });

    const { result } = renderHook(() => useTutorial(WALLET));
    expect(result.current.currentStep).toBe(2);

    act(() => {
      result.current.goBack();
    });

    expect(result.current.currentStep).toBe(1);
  });

  it("should not go back below step 0", () => {
    const { result } = renderHook(() => useTutorial(WALLET));
    expect(result.current.currentStep).toBe(0);

    act(() => {
      result.current.goBack();
    });

    expect(result.current.currentStep).toBe(0);
  });

  it("should not persist goBack to backend", () => {
    mockTutorialQuery.mockReturnValue({
      data: { tutorialStepSeen: 2 },
      isLoading: false,
    });

    const { result } = renderHook(() => useTutorial(WALLET));

    act(() => {
      result.current.goBack();
    });

    expect(mockApiPatch).not.toHaveBeenCalled();
  });

  // ── Dismiss ───────────────────────────────────────────────────

  it("should dismiss tutorial and persist total steps", async () => {
    const { result } = renderHook(() => useTutorial(WALLET));

    await act(async () => {
      result.current.dismiss();
      await vi.waitFor(() => expect(mockApiPatch).toHaveBeenCalled());
    });

    expect(result.current.isActive).toBe(false);
    expect(result.current.currentStep).toBeNull();
    expect(mockApiPatch).toHaveBeenCalledWith(
      `/users/${WALLET}/tutorial`,
      { step: TUTORIAL_TOTAL_STEPS },
    );
  });

  it("should dismiss locally when wallet not connected", () => {
    // Start connected
    const { result, rerender } = renderHook(
      ({ addr }) => useTutorial(addr),
      { initialProps: { addr: WALLET as string | undefined } },
    );
    expect(result.current.isActive).toBe(true);

    // Disconnect, then dismiss
    rerender({ addr: undefined });

    act(() => {
      result.current.dismiss();
    });

    expect(result.current.isActive).toBe(false);
    expect(mockApiPatch).not.toHaveBeenCalled();
  });

  // ── Constants ─────────────────────────────────────────────────

  it("should expose totalSteps constant", () => {
    const { result } = renderHook(() => useTutorial(undefined));
    expect(result.current.totalSteps).toBe(TUTORIAL_TOTAL_STEPS);
  });

  // ── Resilience ────────────────────────────────────────────────

  it("should handle API error gracefully during advance", async () => {
    mockTutorialQuery.mockReturnValue({
      data: { tutorialStepSeen: 0 },
      isLoading: false,
    });
    mockApiPatch.mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() => useTutorial(WALLET));

    // Should advance locally even though API fails
    await act(async () => {
      result.current.advance();
      await vi.waitFor(() => expect(mockApiPatch).toHaveBeenCalled());
    });

    expect(result.current.currentStep).toBe(1);
  });
});
