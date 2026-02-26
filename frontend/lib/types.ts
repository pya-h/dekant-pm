// Frontend types matching actual backend API response shapes.
// The backend returns raw TypeORM entities from MarketEntity.

export enum MarketType {
  Binary = 0,
  MultiOutcome = 1,
  Continuous = 2,
}

export enum MarketState {
  Active = 0,
  Paused = 1,
  PendingResolution = 2,
  Resolved = 3,
}

export enum Role {
  Admin = 1,
  Oracle = 2,
  Creator = 3,
}

// Matches MarketEntity as serialized by NestJS (raw TypeORM entity).
// - PK is `id` (bigint -> string), not `marketId`
// - Dates are ISO 8601 strings (TypeORM serializes Date -> string)
// - `rangeMin`/`rangeMax`/`resolvedValue` are strings (bigint columns)
// - `tags` can be null
// - No `probabilities` field -- compute client-side from reserves
export interface MarketSummary {
  id: string;
  pubkey: string;
  marketType: MarketType;
  state: MarketState;
  creator: string;
  oracle: string;
  collateralMint: string;
  deadline: string;
  createdAt: string;
  resolvedAt: string | null;
  numOutcomes: number;
  title: string;
  description: string | null;
  category: string | null;
  tags: string[] | null;
  imageUrl: string | null;
  outcomeLabels: string[] | null;
  reserves: string[];
  kSquared: string;
  totalMinted: string;
  totalVolume: string;
  totalTraders: number;
  lastTradeAt: string | null;
  rangeMin: string | null;
  rangeMax: string | null;
  resolvedOutcome: number | null;
  resolvedValue: string | null;
}

// Same as MarketSummary -- the backend returns the full entity for both list and detail.
export type MarketDetail = MarketSummary;

// Backend findAll returns { data, total } -- no page/limit/hasMore
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
}

export interface MarketFilters {
  marketType?: MarketType;
  state?: MarketState;
  category?: string;
  search?: string;
  sortBy?: "newest" | "deadline" | "volume";
}

// ---------------------------------------------------------------------------
// AMM probability computation (client-side, matches backend getPrices logic)
// ---------------------------------------------------------------------------

export function computeProbabilities(
  reserves: string[],
  totalMinted: string | number,
): number[] {
  const n = reserves.length;
  if (n === 0) return [];
  const k = Number(totalMinted);
  if (k === 0) return Array(n).fill(1 / n);
  const kSq = k * k;
  return reserves.map((r) => {
    const x = k - Number(r);
    return (x * x) / kSq;
  });
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------
export const USDC_DECIMALS = 6;
export const SCALE = 1_000_000_000;

export function formatUsdc(raw: string | number): string {
  const n = Number(raw) / 10 ** USDC_DECIMALS;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

export function formatProbability(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

export function timeUntil(dateStr: string): string {
  const deadline = new Date(dateStr).getTime();
  const now = Date.now();
  const diff = deadline - now;
  if (diff <= 0) return "Expired";
  const secs = Math.floor(diff / 1000);
  if (secs < 3600) return `${Math.floor(secs / 60)}m left`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h left`;
  return `${Math.floor(secs / 86400)}d left`;
}
