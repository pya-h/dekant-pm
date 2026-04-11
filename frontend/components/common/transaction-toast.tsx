import { toast } from "sonner";
import { AnchorError } from "@coral-xyz/anchor";
import { env } from "@/lib/env";

// ---------------------------------------------------------------------------
// Anchor error code → user-friendly message
// ---------------------------------------------------------------------------

const ERROR_MESSAGES: Record<string, string> = {
  // Trading
  InsufficientBalance: "Insufficient USDC balance",
  InsufficientLiquidity: "Not enough liquidity for this trade",
  InsufficientHoldings: "Insufficient token holdings to sell",
  TradeTooSmall: "Trade amount is below the minimum",
  InvalidSigma: "Confidence must be greater than zero",
  WrongMarketType: "Wrong instruction for this market type",
  MaxCollateralExceeded: "Price moved — try a smaller amount",
  MinCollateralNotMet: "Price moved — try a larger amount",
  InvalidProbability: "Target probability out of valid range",
  TargetAlreadyMet: "Target probability already met",
  // Market state
  MarketNotActive: "This market is not active",
  MarketClosed: "Market deadline has passed",
  MarketPaused: "This market is currently paused",
  MarketNotResolved: "Market has not been resolved yet",
  // Settlement
  AlreadyClaimed: "Payout has already been claimed",
  NothingToClaim: "No winning tokens to claim",
  // Math
  MathOverflow: "Calculation overflow — try a smaller amount",
  InvariantViolation: "AMM invariant violated — try a different amount",
};

// ---------------------------------------------------------------------------
// Solscan URL
// ---------------------------------------------------------------------------

function getSolscanUrl(signature: string): string {
  const base = `https://solscan.io/tx/${signature}`;
  if (env.network === "localnet") {
    return `${base}?cluster=custom&customUrl=${encodeURIComponent(env.rpcUrl)}`;
  }
  if (env.network !== "mainnet-beta") {
    return `${base}?cluster=${env.network}`;
  }
  return base;
}

// ---------------------------------------------------------------------------
// Toast helpers
// ---------------------------------------------------------------------------

export function showTradeSuccess(signature: string, action: string) {
  toast.success(`${action} successful`, {
    description: `${signature.slice(0, 8)}...${signature.slice(-8)}`,
    action: {
      label: "View tx",
      onClick: () => window.open(getSolscanUrl(signature), "_blank"),
    },
  });
}

export function showTradeError(error: unknown) {
  if (error instanceof AnchorError) {
    const code = error.error.errorCode.code;
    const message = ERROR_MESSAGES[code] || error.error.errorMessage;
    toast.error(message);
    return;
  }

  if (error instanceof Error) {
    if (
      error.message.includes("User rejected") ||
      error.message.includes("rejected the request")
    ) {
      toast.error("Transaction cancelled");
      return;
    }
    toast.error(error.message || "Transaction failed");
    return;
  }

  toast.error("An unknown error occurred");
}
