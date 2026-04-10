import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

// ── Constants (mirrors programs/dekant-pm/src/constants.rs) ────────────────

export const MAX_OUTCOMES = 32;
export const MAX_BINS = 256;
export const MIN_LIQUIDITY = 1_000_000; // 1 USDC (6 decimals)
export const MIN_TRADE_AMOUNT = 1_000; // 0.001 USDC
export const MAX_FEE_BPS = 5_000; // 50%
export const SCALE = 1_000_000_000; // 10^9 fixed-point scale

export const DEFAULT_CREATION_FEE_BPS = 50;
export const DEFAULT_TRADE_FEE_BPS = 30;
export const DEFAULT_REDEMPTION_FEE_BPS = 50;
export const DEFAULT_LP_FEE_SHARE_BPS = 5_000;

// PDA seed prefixes
export const PROTOCOL_CONFIG_SEED = "protocol_config";
export const USER_ROLE_SEED = "user_role";
export const MARKET_SEED = "market";
export const VAULT_AUTHORITY_SEED = "vault_authority";
export const USER_POSITION_SEED = "user_position";
export const LP_POSITION_SEED = "lp_position";

export const SCHEMA_VERSION = 1;

// ── Enums ──────────────────────────────────────────────────────────────

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

// ── On-Chain Account Types ─────────────────────────────────────────────
// These mirror the Anchor account structs exactly. Field names match Rust.
// BN is used for u64/u128 values as they exceed JS Number.MAX_SAFE_INTEGER.

export interface ProtocolConfig {
  version: number;
  superadmin: PublicKey;
  treasury: PublicKey;
  marketCount: BN;
  creationFeeBps: number;
  tradeFeeBps: number;
  redemptionFeeBps: number;
  lpFeeShareBps: number;
  bump: number;
}

export interface UserRole {
  version: number;
  user: PublicKey;
  role: number;
  assignedBy: PublicKey;
  assignedAt: BN;
  bump: number;
}

export interface Market {
  version: number;
  marketId: BN;
  marketType: number;
  state: number;
  creator: PublicKey;
  oracle: PublicKey;
  collateralMint: PublicKey;
  vault: PublicKey;
  deadline: BN;
  createdAt: BN;
  resolvedAt: BN;
  numOutcomes: number;
  kSquared: BN;
  totalMinted: BN;
  lpSharesTotal: BN;
  lpFeeAccumulated: BN;
  protocolFeeAccumulated: BN;
  rangeMin: BN;
  rangeMax: BN;
  resolvedOutcome: number;
  resolvedValue: BN;
  bump: number;
  vaultAuthorityBump: number;
  reserves: BN[];
}

export interface UserPosition {
  version: number;
  market: PublicKey;
  user: PublicKey;
  totalDeposited: BN;
  totalWithdrawn: BN;
  claimed: boolean;
  bump: number;
  holdings: BN[];
}

export interface LpPosition {
  version: number;
  market: PublicKey;
  user: PublicKey;
  shares: BN;
  depositedCollateral: BN;
  bump: number;
}

// ── Instruction Args ───────────────────────────────────────────────────
// Mirrors the Anchor #[derive(AnchorSerialize, AnchorDeserialize)] structs.

export interface InitializeArgs {
  treasury: PublicKey;
}

export interface AssignRoleArgs {
  role: number;
}

export interface RevokeRoleArgs {
  role: number;
}

export interface UpdateFeesArgs {
  creationFeeBps: number;
  tradeFeeBps: number;
  redemptionFeeBps: number;
  lpFeeShareBps: number;
}

export interface CreateMarketArgs {
  marketType: number;
  numOutcomes: number;
  deadline: BN;
  oracle: PublicKey;
  initialLiquidity: BN;
  rangeMin: BN;
  rangeMax: BN;
}

export interface ResolveMarketArgs {
  outcome: number;
  value: BN;
}

export interface BuyArgs {
  outcome: number;
  collateralAmount: BN;
}

export interface SellArgs {
  outcome: number;
  tokenAmount: BN;
}

export interface BuyDistributionArgs {
  mu: BN;
  sigma: BN;
  collateralAmount: BN;
}

export interface SellDistributionArgs {
  mu: BN;
  sigma: BN;
  tokenAmount: BN;
}

export interface AddLiquidityArgs {
  amount: BN;
}

export interface RemoveLiquidityArgs {
  sharesToBurn: BN;
}

// ── Event Types ────────────────────────────────────────────────────────
// Mirrors the Anchor #[event] structs. Used by indexer and frontend.

export interface MarketCreatedEvent {
  marketId: BN;
  marketType: number;
  creator: PublicKey;
  oracle: PublicKey;
  collateralMint: PublicKey;
  deadline: BN;
  numOutcomes: number;
  initialLiquidity: BN;
  rangeMin: BN;
  rangeMax: BN;
}

export interface MarketPausedEvent {
  marketId: BN;
  admin: PublicKey;
  timestamp: BN;
}

export interface MarketUnpausedEvent {
  marketId: BN;
  admin: PublicKey;
  timestamp: BN;
}

export interface MarketResolvedEvent {
  marketId: BN;
  oracle: PublicKey;
  resolvedOutcome: number;
  resolvedValue: BN;
  timestamp: BN;
}

export interface TradePlacedEvent {
  marketId: BN;
  trader: PublicKey;
  isBuy: boolean;
  collateralAmount: BN;
  outcomeIndex: number;
  mu: BN;
  sigma: BN;
  tokensTransacted: BN;
  feePaid: BN;
  timestamp: BN;
}

export interface PayoutClaimedEvent {
  marketId: BN;
  trader: PublicKey;
  grossAmount: BN;
  feePaid: BN;
  netAmount: BN;
}

export interface LiquidityChangedEvent {
  marketId: BN;
  provider: PublicKey;
  isAdd: boolean;
  collateralAmount: BN;
  sharesChanged: BN;
  timestamp: BN;
}

export interface FeesCollectedEvent {
  marketId: BN;
  collector: PublicKey;
  amount: BN;
}

export interface FeesUpdatedEvent {
  authority: PublicKey;
  creationFeeBps: number;
  tradeFeeBps: number;
  redemptionFeeBps: number;
  lpFeeShareBps: number;
}

export interface RoleAssignedEvent {
  user: PublicKey;
  role: number;
  assignedBy: PublicKey;
  timestamp: BN;
}

export interface RoleRevokedEvent {
  user: PublicKey;
  role: number;
  revokedBy: PublicKey;
  timestamp: BN;
}

// ── Derived / Display Types ────────────────────────────────────────────
// Serializable types for API responses. Use string for pubkeys and numbers
// that exceed JSON Number range. These are the "over-the-wire" representations.

export interface MarketSummary {
  marketId: string;
  pubkey: string;
  marketType: MarketType;
  state: MarketState;
  creator: string;
  oracle: string;
  collateralMint: string;
  deadline: number; // unix seconds
  createdAt: number;
  resolvedAt: number | null;
  numOutcomes: number;

  // Off-chain metadata
  title: string;
  description: string | null;
  category: string | null;
  tags: string[];
  imageUrl: string | null;
  outcomeLabels: string[] | null;

  // Derived pricing
  probabilities: number[]; // 0..1 float per outcome/bin
  totalVolume: string; // collateral-native as string
  totalTraders: number;
  lastTradeAt: number | null;

  // Continuous-specific
  rangeMin: number | null; // scaled back to human-readable
  rangeMax: number | null;
}

export interface MarketDetail extends MarketSummary {
  // Full on-chain AMM state
  reserves: string[]; // u64[] as strings
  kSquared: string; // u128 as string
  totalMinted: string;
  lpSharesTotal: string;
  lpFeeAccumulated: string;
  protocolFeeAccumulated: string;
  vault: string;

  // Resolution
  resolvedOutcome: number | null;
  resolvedValue: number | null;

  // Fee params (from ProtocolConfig at time of query)
  tradeFeeBps: number;
  redemptionFeeBps: number;
  lpFeeShareBps: number;
}

export interface TradeRecord {
  id: string;
  marketId: string;
  trader: string;
  isBuy: boolean;
  collateralAmount: string;
  outcomeIndex: number | null;
  mu: number | null;
  sigma: number | null;
  tokensTransacted: string;
  feePaid: string;
  txSignature: string;
  slot: number;
  timestamp: number;
}

export interface UserPositionSummary {
  marketId: string;
  marketPubkey: string;
  marketTitle: string;
  marketType: MarketType;
  marketState: MarketState;
  holdings: string[]; // u64[] as strings
  totalDeposited: string;
  totalWithdrawn: string;
  claimed: boolean;
  // Derived
  currentValue: string; // estimated liquidation value
  unrealizedPnl: string;
  outcomeLabels: string[] | null;
}

export interface LpPositionSummary {
  marketId: string;
  marketPubkey: string;
  marketTitle: string;
  shares: string;
  depositedCollateral: string;
  shareOfPool: number; // 0..1 float
  currentValue: string;
}

export interface RoleAssignment {
  user: string;
  role: Role;
  assignedBy: string;
  assignedAt: number;
}

// ── Utility Types ──────────────────────────────────────────────────────

export interface PaginationParams {
  page: number;
  limit: number;
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
  creator?: string;
  oracle?: string;
  category?: string;
  tags?: string[];
  search?: string; // full-text search on title/description
  sortBy?: "deadline" | "created_at" | "volume" | "traders" | "last_trade";
  sortDirection?: SortDirection;
}
