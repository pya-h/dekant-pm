import { env } from "./env";

const REQUEST_TIMEOUT_MS = 15_000;

class ApiClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = env.backendUrl;
  }

  async get<T>(
    path: string,
    params?: Record<string, unknown>,
    token?: string,
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") {
          if (Array.isArray(value)) {
            value.forEach((v) => url.searchParams.append(key, String(v)));
          } else {
            url.searchParams.set(key, String(value));
          }
        }
      }
    }

    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(url.toString(), {
        cache: "no-store",
        headers,
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new ApiError(
          res.status,
          body?.message ?? res.statusText,
          body?.code,
        );
      }
      return res.json();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new ApiError(0, "Request timed out — is the backend running?");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async post<T>(path: string, body: unknown, token?: string): Promise<T> {
    return this.mutate<T>("POST", path, body, token);
  }

  async patch<T>(path: string, body: unknown, token?: string): Promise<T> {
    return this.mutate<T>("PATCH", path, body, token);
  }

  async delete<T>(path: string, token?: string): Promise<T> {
    return this.mutate<T>("DELETE", path, undefined, token);
  }

  private async mutate<T>(
    method: string,
    path: string,
    body: unknown,
    token?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(new URL(path, this.baseUrl).toString(), {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new ApiError(
          res.status,
          data?.message ?? res.statusText,
          data?.code,
        );
      }
      return res.json();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new ApiError(0, "Request timed out — is the backend running?");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const api = new ApiClient();
