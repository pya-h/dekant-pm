import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Set required env vars before any module imports
process.env.NEXT_PUBLIC_PROGRAM_ID =
  "4GYvtbs7da26tLaZt9PNQWLesq2riwEN6fi9tGF91A5P";
process.env.NEXT_PUBLIC_BACKEND_URL = "http://localhost:4000";
process.env.NEXT_PUBLIC_RPC_URL = "http://localhost:8899";

// Cleanup DOM between tests (auto-cleanup requires globals: true)
afterEach(() => cleanup());

// jsdom doesn't provide ResizeObserver (needed by Radix UI slider)
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
