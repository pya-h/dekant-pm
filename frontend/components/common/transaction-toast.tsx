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
  // Guard: ensure signature is a displayable string
  const sig = typeof signature === "string" ? signature : String(signature ?? "");
  const label = typeof action === "string" ? action : "Trade";

  if (!sig) {
    toast.success(`${label} submitted`);
    return;
  }

  toast.success(`${label} successful`, {
    description: `${sig.slice(0, 8)}...${sig.slice(-8)}`,
    action: {
      label: "View tx",
      onClick: () => window.open(getSolscanUrl(sig), "_blank"),
    },
  });
}

export function showTradeError(error: unknown) {
  // 1. Anchor program errors (parsed)
  if (error instanceof AnchorError) {
    const code = error.error.errorCode.code;
    const message = ERROR_MESSAGES[code] || error.error.errorMessage;
    toast.error(message);
    return;
  }

  // 2. User rejection (wallet declined)
  if (isUserRejection(error)) {
    toast.error("Transaction cancelled");
    return;
  }

  // 3. Insufficient SOL for fees
  if (isInsufficientSolError(error)) {
    toast.error("Insufficient SOL for transaction fees");
    return;
  }

  // 4. Transaction simulation failure — try to extract program error code
  const anchorCode = extractAnchorCodeFromLogs(error);
  if (anchorCode && ERROR_MESSAGES[anchorCode]) {
    toast.error(ERROR_MESSAGES[anchorCode]);
    return;
  }

  // 5. Blockhash / expiry errors
  if (isBlockhashError(error)) {
    toast.error("Transaction expired — please try again");
    return;
  }

  // 6. Network / timeout errors
  if (isNetworkError(error)) {
    toast.error("Network error — check your connection and try again");
    return;
  }

  // 7. Generic Error with a message
  if (error instanceof Error) {
    // Truncate very long error messages (e.g. full simulation logs)
    const msg = error.message || "Transaction failed";
    toast.error(msg.length > 120 ? msg.slice(0, 120) + "…" : msg);
    return;
  }

  // 8. Fallback
  toast.error("Transaction failed — please try again");
}

// ---------------------------------------------------------------------------
// Error detection helpers
// ---------------------------------------------------------------------------

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "";
}

function isUserRejection(error: unknown): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  return (
    msg.includes("user rejected") ||
    msg.includes("rejected the request") ||
    msg.includes("user denied") ||
    msg.includes("user cancelled") ||
    msg.includes("user canceled") ||
    msg.includes("request rejected")
  );
}

function isInsufficientSolError(error: unknown): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  return (
    msg.includes("insufficient funds") ||
    msg.includes("insufficient lamports") ||
    msg.includes("not enough sol") ||
    msg.includes("0x1") && msg.includes("insufficient") ||
    // Simulation failure with insufficient balance for rent
    msg.includes("insufficient balance for rent") ||
    msg.includes("account balance below rent-exempt minimum")
  );
}

function isBlockhashError(error: unknown): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  return (
    msg.includes("blockhash not found") ||
    msg.includes("block height exceeded") ||
    msg.includes("transaction has already been processed") ||
    msg.includes("transaction was not confirmed")
  );
}

function isNetworkError(error: unknown): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("network request failed") ||
    msg.includes("networkerror") ||
    msg.includes("timeout") ||
    msg.includes("econnrefused") ||
    msg.includes("socket hang up")
  );
}

/** Try to extract an Anchor error code from SendTransactionError logs. */
function extractAnchorCodeFromLogs(error: unknown): string | null {
  // Check for logs in SendTransactionError or similar
  const logs = getLogs(error);
  if (!logs || logs.length === 0) return null;

  // Anchor logs errors as: "Program log: AnchorError ... Error Code: SomeCode."
  for (const log of logs) {
    const codeMatch = log.match(/Error Code:\s*(\w+)/);
    if (codeMatch) return codeMatch[1];
  }

  // Also check for custom program error hex codes
  const msg = getErrorMessage(error);
  const hexMatch = msg.match(/custom program error:\s*0x([0-9a-fA-F]+)/);
  if (hexMatch) {
    const errorNum = parseInt(hexMatch[1], 16);
    // Anchor error codes start at 6000 (0x1770)
    if (errorNum >= 6000) {
      const anchorOffset = errorNum - 6000;
      const codes = Object.keys(ERROR_MESSAGES);
      if (anchorOffset < codes.length) return codes[anchorOffset];
    }
  }

  return null;
}

function getLogs(error: unknown): string[] | null {
  if (!error || typeof error !== "object") return null;
  // SendTransactionError has .logs
  if ("logs" in error && Array.isArray((error as { logs: unknown }).logs)) {
    return (error as { logs: string[] }).logs;
  }
  // Some errors nest it in .simulationResponse
  if ("simulationResponse" in error) {
    const sim = (error as { simulationResponse: { logs?: string[] } }).simulationResponse;
    if (sim?.logs && Array.isArray(sim.logs)) return sim.logs;
  }
  return null;
}
