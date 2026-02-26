// Re-export shared types for frontend use.
// These mirror the backend API response shapes exactly.

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

export interface MarketSummary {
  marketId: string;
  pubkey: string;
  marketType: MarketType;
  state: MarketState;
  creator: string;
  oracle: string;
  collateralMint: string;
  deadline: number;
  createdAt: number;
  resolvedAt: number | null;
  numOutcomes: number;
  title: string;
  description: string | null;
  category: string | null;
  tags: string[];
  imageUrl: string | null;
  outcomeLabels: string[] | null;
  probabilities: number[];
  totalVolume: string;
  totalTraders: number;
  lastTradeAt: number | null;
  rangeMin: number | null;
  rangeMax: number | null;
}

export interface MarketDetail extends MarketSummary {
  reserves: string[];
  kSquared: string;
  totalMinted: string;
  lpSharesTotal: string;
  lpFeeAccumulated: string;
  protocolFeeAccumulated: string;
  vault: string;
  resolvedOutcome: number | null;
  resolvedValue: number | null;
  tradeFeeBps: number;
  redemptionFeeBps: number;
  lpFeeShareBps: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export type SortDirection = "asc" | "desc";

export interface MarketFilters {
  marketType?: MarketType;
  state?: MarketState;
  category?: string;
  search?: string;
  sortBy?: "deadline" | "created_at" | "volume" | "traders" | "last_trade";
  sortDirection?: SortDirection;
}

// USDC has 6 decimals
export const USDC_DECIMALS = 6;

export function formatUsdc(raw: string | number): string {
  const n = Number(raw) / 10 ** USDC_DECIMALS;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

export function formatProbability(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

export function timeUntil(unixSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = unixSeconds - now;
  if (diff <= 0) return "Expired";
  if (diff < 3600) return `${Math.floor(diff / 60)}m left`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h left`;
  return `${Math.floor(diff / 86400)}d left`;
}
