import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditMarketModal } from "@/components/market/edit-market-modal";
import { mockBinaryMarket } from "../helpers/mock-data";

const mockPatch = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    patch: (...args: unknown[]) => mockPatch(...args),
  },
}));

describe("EditMarketModal", () => {
  const defaultProps = {
    market: mockBinaryMarket,
    open: true,
    onOpenChange: vi.fn(),
    token: "test-jwt",
    onSuccess: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPatch.mockResolvedValue({});
  });

  it("renders the modal with market title", () => {
    render(<EditMarketModal {...defaultProps} />);
    expect(screen.getByText("Edit Market")).toBeInTheDocument();
    expect(screen.getByText(mockBinaryMarket.title)).toBeInTheDocument();
  });

  it("renders form fields with current values", () => {
    render(<EditMarketModal {...defaultProps} />);
    const categoryInput = screen.getByLabelText("Category") as HTMLInputElement;
    const subjectInput = screen.getByLabelText("Subject") as HTMLInputElement;
    expect(categoryInput.value).toBe(mockBinaryMarket.category);
    expect(subjectInput.value).toBe(mockBinaryMarket.subject);
  });

  it("closes without API call when no changes are made", async () => {
    const user = userEvent.setup();
    render(<EditMarketModal {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(mockPatch).not.toHaveBeenCalled();
    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("sends only changed fields to the API", async () => {
    const user = userEvent.setup();
    render(<EditMarketModal {...defaultProps} />);

    const subjectInput = screen.getByLabelText("Subject");
    await user.clear(subjectInput);
    await user.type(subjectInput, "ETH");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith(
        `/markets/${mockBinaryMarket.id}`,
        expect.objectContaining({ subject: "ETH" }),
        "test-jwt",
      );
    });
    expect(defaultProps.onSuccess).toHaveBeenCalled();
  });

  it("shows error on API failure", async () => {
    mockPatch.mockRejectedValue(new Error("Network error"));
    const user = userEvent.setup();
    render(<EditMarketModal {...defaultProps} />);

    const subjectInput = screen.getByLabelText("Subject");
    await user.clear(subjectInput);
    await user.type(subjectInput, "SOL");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });
  });

  it("closes when Cancel is clicked", async () => {
    const user = userEvent.setup();
    render(<EditMarketModal {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
  });
});
