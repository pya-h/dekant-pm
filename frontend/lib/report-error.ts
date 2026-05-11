import { env } from "./env";

type Level = "error" | "warn" | "info";

interface ReportPayload {
  level?: Level;
  event: string;
  message: string;
  context?: Record<string, unknown>;
}

/**
 * Fire-and-forget client → server log forwarder. Errors here are swallowed
 * (no infinite loops, no UX impact). Server pipes into Pino → log drain.
 */
export function reportClientError({
  level = "error",
  event,
  message,
  context,
}: ReportPayload): void {
  if (typeof window === "undefined") return;

  try {
    const url = new URL("/logs", env.backendUrl).toString();
    const body = JSON.stringify({
      level,
      event,
      message: message.slice(0, 2000),
      context,
    });

    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(url, blob)) return;
    }

    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // never throw from logger
  }
}

/** Extract Anchor/Solana program logs from a thrown error if present. */
export function extractTxLogs(err: unknown): string[] | undefined {
  if (err && typeof err === "object" && "logs" in err) {
    const logs = (err as { logs?: unknown }).logs;
    if (Array.isArray(logs)) return logs.map(String).slice(0, 50);
  }
  return undefined;
}
