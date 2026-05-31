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
  subject: string;
  tags: string[] | null;
  icon: string | null;
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
  lpSharesTotal: string;
  lpFeeAccumulated: string;
  protocolFeeAccumulated: string;
  // Smooth-kernel resolution (continuous markets only).
  // `kernelWidth = 0` ⇒ winner-take-all; `> 0` ⇒ triangular kernel.
  // `scalingFactor` is SCALE-denominated (10^9), set at resolution.
  // Optional for transitional API compatibility — default to 0 / "0" at use sites.
  kernelWidth?: number;
  scalingFactor?: string;
  // Aggregate trader holdings per bin, mirrored from on-chain
  // `Market.trader_token_totals`. Drives the pre-resolution scaling-factor
  // estimator (see `estimateScalingFactor` in portfolio-utils). Empty array
  // when the backend hasn't backfilled yet — treat as "no dilution".
  traderTokenTotals?: string[];
}

// Same as MarketSummary -- the backend returns the full entity for both list and detail.
export type MarketDetail = MarketSummary;

// Matches UserPositionEntity with nested market relation.
export interface UserPosition {
  id: string;
  marketId: string;
  market: MarketSummary;
  userAddress: string;
  holdings: string[];
  totalDeposited: string;
  totalWithdrawn: string;
  claimed: boolean;
  updatedAt: string;
}

// Matches LpPositionEntity with nested market relation.
export interface LpPosition {
  id: string;
  marketId: string;
  market: MarketSummary;
  userAddress: string;
  shares: string;
  depositedCollateral: string;
  updatedAt: string;
}

// Matches TradeEntity with nested market relation.
// `trader` and `username` may be masked by the backend based on caller role.
export interface Trade {
  id: string;
  marketId: string;
  market: MarketSummary;
  trader: string;
  username: string | null;
  isBuy: boolean;
  collateralAmount: string;
  outcomeIndex: number | null;
  mu: string | null;
  sigma: string | null;
  tokensTransacted: string;
  feePaid: string;
  txSignature: string;
  slot: string;
  timestamp: string;
}

// Backend findAll returns { data, total } -- no page/limit/hasMore
// Optional `stats` included when `includeStats=true` query param is set.
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  stats?: {
    totalVolume: string;
    totalTraders: number;
  };
}

// Matches UserRoleEntity as serialized by NestJS.
export interface UserRoleEntry {
  id: string;
  userAddress: string;
  role: number;
  assignedBy: string;
  assignedAt: string;
}

// Matches UserEntity as serialized by NestJS.
export interface UserProfile {
  id: string;
  walletAddress: string;
  username: string;
  email: string | null;
  avatar: string | null;
  tutorialStepSeen: number;
  createdAt: string;
  updatedAt: string;
}

export interface MarketFilters {
  marketType?: MarketType;
  state?: MarketState;
  category?: string;
  subject?: string;
  oracle?: string;
  creator?: string;
  search?: string;
  sortBy?: "newest" | "deadline" | "volume";
  createdAfter?: string;
}

// Linear probability display: p_i = x_i / sum(x_j), where x_i = totalMinted - reserves[i].
// Exact at equilibrium; see specs/details/improved/LINEAR_DISPLAY_EXPLAINED.md.
export function computeProbabilities(
  reserves: string[],
  totalMinted: string | number,
): number[] {
  const n = reserves.length;
  if (n === 0) return [];
  const tm = Number(totalMinted);
  if (tm === 0) return Array(n).fill(1 / n);
  const xs = reserves.map((r) => tm - Number(r));
  const sumX = xs.reduce((acc, x) => acc + x, 0);
  if (sumX === 0) return Array(n).fill(1 / n);
  return xs.map((x) => x / sumX);
}

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
