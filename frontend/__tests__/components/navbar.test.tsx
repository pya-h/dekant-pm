import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Navbar } from "@/components/layout/navbar";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockUseWallet = vi.fn();
vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: (...args: unknown[]) => mockUseWallet(...args),
}));

const mockUseAdminRole = vi.fn();
vi.mock("@/hooks/use-admin-role", () => ({
  useAdminRole: (...args: unknown[]) => mockUseAdminRole(...args),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// WalletButton makes wallet adapter calls — stub it
vi.mock("@/components/common/wallet-button", () => ({
  WalletButton: () => <button data-testid="wallet-button">Wallet</button>,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultRoles = {
  isSuperadmin: false,
  isAdmin: false,
  isCreator: false,
  isOracle: false,
  isAuthorized: false,
  isLoading: false,
};

function setupMocks(
  connected: boolean,
  roles: Partial<typeof defaultRoles> = {},
) {
  mockUseWallet.mockReturnValue({ connected, publicKey: connected ? {} : null });
  mockUseAdminRole.mockReturnValue({ ...defaultRoles, ...roles });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Navbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hides Portfolio link when not connected, shows search bar", () => {
    setupMocks(false);
    render(<Navbar />);

    expect(
      screen.queryByRole("link", { name: "Portfolio" }),
    ).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search markets...")).toBeInTheDocument();
  });

  it("shows Portfolio link when connected", () => {
    setupMocks(true);
    render(<Navbar />);

    expect(
      screen.getByRole("link", { name: "Portfolio" }),
    ).toBeInTheDocument();
  });

  // ── Not connected ───────────────────────────────────────────────

  it("hides Admin link when not connected", () => {
    setupMocks(false);
    render(<Navbar />);

    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  });

  it("hides Creator link when not connected", () => {
    setupMocks(false);
    render(<Navbar />);

    expect(
      screen.queryByRole("link", { name: "Creator" }),
    ).not.toBeInTheDocument();
  });

  it("hides Oracle link when not connected", () => {
    setupMocks(false);
    render(<Navbar />);

    expect(
      screen.queryByRole("link", { name: "Oracle" }),
    ).not.toBeInTheDocument();
  });

  // ── Connected, no roles ─────────────────────────────────────────

  it("hides all role links when connected with no roles", () => {
    setupMocks(true);
    render(<Navbar />);

    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Creator" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Oracle" }),
    ).not.toBeInTheDocument();
  });

  // ── Creator-only user ───────────────────────────────────────────

  it("shows Creator link for creator-only user", () => {
    setupMocks(true, { isCreator: true });
    render(<Navbar />);

    expect(
      screen.getByRole("link", { name: "Creator" }),
    ).toHaveAttribute("href", "/creator");
  });

  it("hides Admin link for creator-only user", () => {
    setupMocks(true, { isCreator: true });
    render(<Navbar />);

    expect(screen.queryByRole("link", { name: "Admin" })).not.toBeInTheDocument();
  });

  // ── Admin user ──────────────────────────────────────────────────

  it("shows Admin link for admin user", () => {
    setupMocks(true, { isAdmin: true, isAuthorized: true });
    render(<Navbar />);

    expect(
      screen.getByRole("link", { name: "Admin" }),
    ).toHaveAttribute("href", "/admin");
  });

  it("hides Creator link for admin user (admin panel has Creator tab)", () => {
    setupMocks(true, { isAdmin: true, isAuthorized: true });
    render(<Navbar />);

    expect(
      screen.queryByRole("link", { name: "Creator" }),
    ).not.toBeInTheDocument();
  });

  // ── Superadmin user ─────────────────────────────────────────────

  it("shows Admin link for superadmin", () => {
    setupMocks(true, { isSuperadmin: true, isAuthorized: true });
    render(<Navbar />);

    expect(
      screen.getByRole("link", { name: "Admin" }),
    ).toHaveAttribute("href", "/admin");
  });

  it("hides Creator link for superadmin", () => {
    setupMocks(true, { isSuperadmin: true, isAuthorized: true });
    render(<Navbar />);

    expect(
      screen.queryByRole("link", { name: "Creator" }),
    ).not.toBeInTheDocument();
  });

  // ── Admin + Creator dual role ───────────────────────────────────

  it("shows Admin but not Creator when user has both roles", () => {
    setupMocks(true, {
      isAdmin: true,
      isCreator: true,
      isAuthorized: true,
    });
    render(<Navbar />);

    expect(screen.getByRole("link", { name: "Admin" })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Creator" }),
    ).not.toBeInTheDocument();
  });

  // ── Oracle user ─────────────────────────────────────────────────

  it("shows Oracle link for oracle user", () => {
    setupMocks(true, { isOracle: true });
    render(<Navbar />);

    expect(
      screen.getByRole("link", { name: "Oracle" }),
    ).toHaveAttribute("href", "/oracle");
  });

  // ── Creator + Oracle dual role ──────────────────────────────────

  it("shows both Creator and Oracle for user with both roles", () => {
    setupMocks(true, { isCreator: true, isOracle: true });
    render(<Navbar />);

    expect(screen.getByRole("link", { name: "Creator" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Oracle" })).toBeInTheDocument();
  });
});
