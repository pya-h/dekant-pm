import { toast } from "sonner";
import { AnchorError } from "@coral-xyz/anchor";
import { SendTransactionError } from "@solana/web3.js";
import { env } from "@/lib/env";

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
  // Fee collection
  NoFeesToCollect: "No protocol fees to collect on this market",
  // Math
  MathOverflow: "Calculation overflow — try a smaller amount",
  InvariantViolation: "AMM invariant violated — try a different amount",
};

// Map on-chain error code numbers to code names (must match DekantPmError enum order).
const ERROR_CODE_BY_NUM: Record<number, string> = {
  // Authorization (6000–6003)
  // 6000: Unauthorized, 6001: InvalidRole, 6002: RoleAlreadyAssigned, 6003: AdminCannotAssignAdmin
  // Market Lifecycle (6004–6010)
  6004: "MarketNotActive",
  6005: "MarketClosed",
  6008: "MarketPaused",
  6010: "MarketNotResolved",
  // Trading (6017–6026)
  6017: "InsufficientBalance",
  6018: "InsufficientLiquidity",
  6019: "InsufficientHoldings",
  6020: "TradeTooSmall",
  6021: "InvalidSigma",
  6022: "WrongMarketType",
  6023: "InvalidProbability",
  6024: "TargetAlreadyMet",
  6025: "MaxCollateralExceeded",
  6026: "MinCollateralNotMet",
  // Settlement (6027–6028)
  6027: "AlreadyClaimed",
  6028: "NothingToClaim",
  // Math (6029–6030)
  6029: "InvariantViolation",
  6030: "MathOverflow",
  // Fees (6034)
  6034: "NoFeesToCollect",
};

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

  // 4. SendTransactionError — extract logs, signature, and program error
  const txInfo = extractTxInfo(error);
  if (txInfo) {
    const { message, signature } = txInfo;
    if (signature) {
      toast.error(message, {
        description: `${signature.slice(0, 8)}...${signature.slice(-8)}`,
        action: {
          label: "View tx",
          onClick: () => window.open(getSolscanUrl(signature), "_blank"),
        },
      });
    } else {
      toast.error(message);
    }
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
    const msg = error.message || "Transaction failed";
    toast.error(msg.length > 120 ? msg.slice(0, 120) + "…" : msg);
    return;
  }

  // 8. Fallback
  toast.error("Transaction failed — please try again");
}

/** Extract useful info from transaction errors, including the Anchor/web3.js compat bug. */
function extractTxInfo(
  error: unknown,
): { message: string; signature: string | null } | null {
  if (!error || typeof error !== "object") return null;

  // Try to get logs from the error (SendTransactionError, or any error with .logs)
  const logs = getLogs(error);
  const anchorCode = logs ? extractAnchorCodeFromLogsList(logs) : null;

  // Try to extract signature from the error
  let signature: string | null = null;
  if ("signature" in error && typeof (error as { signature: unknown }).signature === "string") {
    signature = (error as { signature: string }).signature;
  }

  // Anchor 0.32.1 / web3.js 1.98.x compat bug: SendTransactionError constructed
  // with wrong args produces "Unknown action 'undefined'". The original error info
  // (signature, logs) is lost. Also handle ConfirmError pattern.
  const msg = getErrorMessage(error);

  if (msg.includes("Unknown action")) {
    // Broken SendTransactionError — all useful info is lost.
    // Try to find a program error code from logs if they survived.
    if (anchorCode && ERROR_MESSAGES[anchorCode]) {
      return { message: ERROR_MESSAGES[anchorCode], signature };
    }
    return {
      message: "Transaction failed on-chain — try reducing spread or amount",
      signature,
    };
  }

  // ConfirmError pattern: "Raw transaction <sig> failed ({...})"
  const confirmMatch = msg.match(
    /Raw transaction\s+([1-9A-HJ-NP-Za-km-z]{32,88})\s+failed\s*\((.+)\)/,
  );
  if (confirmMatch) {
    signature = confirmMatch[1];
    const statusJson = confirmMatch[2];

    // Try to extract Custom error code from status JSON
    const customMatch = statusJson.match(/"Custom"\s*:\s*(\d+)/);
    if (customMatch) {
      const errorNum = parseInt(customMatch[1], 10);
      const codeName = ERROR_CODE_BY_NUM[errorNum];
      if (codeName && ERROR_MESSAGES[codeName]) {
        return { message: ERROR_MESSAGES[codeName], signature };
      }
    }

    // Check for compute budget exceeded
    if (statusJson.includes("ComputationalBudgetExceeded") || statusJson.includes("ProgramFailedToComplete")) {
      return {
        message: "Transaction ran out of compute — try reducing spread",
        signature,
      };
    }

    if (anchorCode && ERROR_MESSAGES[anchorCode]) {
      return { message: ERROR_MESSAGES[anchorCode], signature };
    }

    return { message: "Transaction failed on-chain", signature };
  }

  // SendTransactionError with proper constructor (web3.js native throw)
  if (error instanceof SendTransactionError) {
    if (anchorCode && ERROR_MESSAGES[anchorCode]) {
      return { message: ERROR_MESSAGES[anchorCode], signature };
    }
    const txMsg =
      "transactionMessage" in error
        ? String((error as unknown as Record<string, unknown>).transactionMessage)
        : "";
    if (txMsg.includes("exceeded")) {
      return {
        message: "Transaction ran out of compute — try reducing spread",
        signature,
      };
    }
    return {
      message: txMsg
        ? txMsg.length > 120
          ? txMsg.slice(0, 120) + "…"
          : txMsg
        : "Transaction failed on-chain",
      signature,
    };
  }

  // Non-SendTransactionError but has logs — try to extract Anchor code
  if (anchorCode && ERROR_MESSAGES[anchorCode]) {
    return { message: ERROR_MESSAGES[anchorCode], signature };
  }

  // Check for compute budget in generic error messages
  if (
    msg.includes("exceeded") ||
    msg.includes("Computational budget") ||
    msg.includes("ProgramFailedToComplete")
  ) {
    return {
      message: "Transaction ran out of compute — try reducing spread",
      signature,
    };
  }

  return null;
}

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
    (msg.includes("0x1") && msg.includes("insufficient")) ||
    // Simulation failure with insufficient balance for rent
    msg.includes("insufficient balance for rent") ||
    msg.includes("account balance below rent-exempt minimum") ||
    // Wallet has never been funded (0 SOL)
    msg.includes("attempt to debit an account but found no record of a prior credit")
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

/** Extract Anchor error code name from a list of program logs. */
function extractAnchorCodeFromLogsList(logs: string[]): string | null {
  for (const log of logs) {
    const codeMatch = log.match(/Error Code:\s*(\w+)/);
    if (codeMatch) return codeMatch[1];
  }

  // Check for custom program error hex codes in logs
  for (const log of logs) {
    const hexMatch = log.match(/custom program error:\s*0x([0-9a-fA-F]+)/i);
    if (hexMatch) {
      const errorNum = parseInt(hexMatch[1], 16);
      const codeName = ERROR_CODE_BY_NUM[errorNum];
      if (codeName) return codeName;
    }
  }

  return null;
}

function getLogs(error: unknown): string[] | null {
  if (!error || typeof error !== "object") return null;
  // SendTransactionError has .logs or .transactionLogs
  if ("logs" in error && Array.isArray((error as { logs: unknown }).logs)) {
    return (error as { logs: string[] }).logs;
  }
  if (
    "transactionLogs" in error &&
    Array.isArray((error as { transactionLogs: unknown }).transactionLogs)
  ) {
    return (error as { transactionLogs: string[] }).transactionLogs;
  }
  // Some errors nest it in .simulationResponse
  if ("simulationResponse" in error) {
    const sim = (error as { simulationResponse: { logs?: string[] } })
      .simulationResponse;
    if (sim?.logs && Array.isArray(sim.logs)) return sim.logs;
  }
  return null;
}
