import type {
  MarketType,
  MarketSummary,
  MarketDetail,
  TradeRecord,
  UserPositionSummary,
  LpPositionSummary,
  RoleAssignment,
  PaginatedResponse,
  PaginationParams,
  MarketFilters,
} from "./types";

// ── Markets API ────────────────────────────────────────────────────────

// GET /markets
export interface ListMarketsRequest extends PaginationParams, MarketFilters {}

export type ListMarketsResponse = PaginatedResponse<MarketSummary>;

// GET /markets/:id
export interface GetMarketResponse {
  market: MarketDetail;
}

// GET /markets/:id/prices
export interface GetMarketPricesResponse {
  marketId: string;
  probabilities: number[]; // 0..1 per outcome/bin
  timestamp: number;
}

// GET /markets/:id/history
export interface GetMarketHistoryRequest extends PaginationParams {
  traderFilter?: string; // optional: filter by trader address
}

export type GetMarketHistoryResponse = PaginatedResponse<TradeRecord>;

// POST /markets (create off-chain metadata — the on-chain tx is sent by the frontend)
export interface CreateMarketMetadataRequest {
  /** On-chain market ID (assigned during create_market tx). */
  marketId: string;
  /** Market PDA address (base58). */
  pubkey: string;
  title: string;
  description?: string;
  category?: string;
  tags?: string[];
  imageUrl?: string;
  /** Human-readable labels for each outcome/bin. */
  outcomeLabels?: string[];
}

export interface CreateMarketMetadataResponse {
  marketId: string;
  success: boolean;
}

// ── Users API ──────────────────────────────────────────────────────────

// GET /users/:address/positions
export interface GetUserPositionsRequest extends PaginationParams {
  /** Filter by market state. */
  marketState?: "active" | "resolved" | "all";
}

export interface GetUserPositionsResponse {
  address: string;
  positions: UserPositionSummary[];
  lpPositions: LpPositionSummary[];
  /** Aggregate stats. */
  stats: {
    totalDeposited: string;
    totalWithdrawn: string;
    totalClaimed: string;
    unrealizedPnl: string;
    activeMarkets: number;
    resolvedMarkets: number;
  };
}

// GET /users/:address/history
export interface GetUserHistoryRequest extends PaginationParams {
  marketId?: string; // optional: filter by specific market
}

export type GetUserHistoryResponse = PaginatedResponse<TradeRecord>;

// ── AMM Estimation API ─────────────────────────────────────────────────
// Off-chain cost/return estimation that mirrors on-chain AMM logic.

// POST /amm/estimate-buy
export interface EstimateBuyRequest {
  marketId: string;
  /** For discrete: single outcome index. */
  outcome?: number;
  /** For continuous: mu and sigma define the distribution. */
  mu?: number;
  sigma?: number;
  /** Collateral to spend (token-native units as string). */
  collateralAmount: string;
}

export interface EstimateBuyResponse {
  /** Tokens received per outcome/bin. */
  tokensOut: string[];
  /** Total tokens received (sum). */
  totalTokensOut: string;
  /** Fee deducted (token-native units). */
  fee: string;
  /** Effective collateral after fee. */
  effectiveCollateral: string;
  /** Average price per token (collateral / totalTokensOut). */
  avgPrice: number;
  /** Price impact as a fraction (0..1). */
  priceImpact: number;
  /** New implied probabilities after this hypothetical trade. */
  newProbabilities: number[];
}

// POST /amm/estimate-sell
export interface EstimateSellRequest {
  marketId: string;
  /** For discrete: single outcome index. */
  outcome?: number;
  /** For continuous: mu and sigma define the distribution. */
  mu?: number;
  sigma?: number;
  /** Tokens to sell (token-native units as string). */
  tokenAmount: string;
}

export interface EstimateSellResponse {
  /** Collateral returned before fees. */
  grossCollateralOut: string;
  /** Fee deducted. */
  fee: string;
  /** Collateral returned after fees. */
  netCollateralOut: string;
  /** Average sell price per token. */
  avgPrice: number;
  /** Price impact as a fraction (0..1). */
  priceImpact: number;
  /** New implied probabilities after this hypothetical trade. */
  newProbabilities: number[];
}

// POST /amm/estimate-add-liquidity
export interface EstimateAddLiquidityRequest {
  marketId: string;
  amount: string;
}

export interface EstimateAddLiquidityResponse {
  /** LP shares that would be minted. */
  sharesOut: string;
  /** Share of pool after deposit. */
  shareOfPool: number;
}

// POST /amm/estimate-remove-liquidity
export interface EstimateRemoveLiquidityRequest {
  marketId: string;
  sharesToBurn: string;
}

export interface EstimateRemoveLiquidityResponse {
  /** Collateral returned. */
  collateralOut: string;
  /** LP fee share returned. */
  feeShareOut: string;
  /** Total payout (collateral + fee share). */
  totalOut: string;
}

// POST /amm/estimate-payout
export interface EstimatePayoutRequest {
  marketId: string;
  userAddress: string;
}

export interface EstimatePayoutResponse {
  /** Winning outcome/bin holdings. */
  winningHoldings: string;
  grossPayout: string;
  fee: string;
  netPayout: string;
  /** Whether the user has already claimed. */
  claimed: boolean;
}

// ── Auth API ───────────────────────────────────────────────────────────
// Wallet-based authentication using sign-in-with-solana pattern.

// POST /auth/challenge
export interface AuthChallengeRequest {
  /** Wallet address (base58). */
  address: string;
}

export interface AuthChallengeResponse {
  /** Nonce to sign. */
  nonce: string;
  /** Human-readable message to sign. */
  message: string;
  /** Expiry timestamp for this challenge. */
  expiresAt: number;
}

// POST /auth/verify
export interface AuthVerifyRequest {
  /** Wallet address (base58). */
  address: string;
  /** The signed message bytes (base64 or hex). */
  signature: string;
  /** The original nonce from the challenge. */
  nonce: string;
}

export interface AuthVerifyResponse {
  /** JWT access token. */
  accessToken: string;
  /** Token expiry in seconds. */
  expiresIn: number;
}

// ── Admin API ──────────────────────────────────────────────────────────

// GET /admin/roles
export interface ListRolesRequest extends PaginationParams {
  role?: number; // filter by role type
  user?: string; // filter by user address
}

export type ListRolesResponse = PaginatedResponse<RoleAssignment>;

// GET /admin/markets/stale
export interface ListStaleMarketsRequest extends PaginationParams {
  /** Threshold in seconds past deadline to consider "stale". Default: 3600. */
  thresholdSeconds?: number;
}

export type ListStaleMarketsResponse = PaginatedResponse<MarketSummary>;

// GET /admin/config
export interface GetProtocolConfigResponse {
  superadmin: string;
  treasury: string;
  marketCount: string;
  creationFeeBps: number;
  tradeFeeBps: number;
  redemptionFeeBps: number;
  lpFeeShareBps: number;
}

// ── WebSocket Events ───────────────────────────────────────────────────
// Events pushed to frontend via WebSocket for real-time updates.

export enum WsEventType {
  MarketUpdate = "market_update",
  TradeExecuted = "trade_executed",
  MarketResolved = "market_resolved",
  PriceUpdate = "price_update",
  LiquidityUpdate = "liquidity_update",
}

export interface WsMessage<T = unknown> {
  type: WsEventType;
  data: T;
  timestamp: number;
}

export interface WsMarketUpdateData {
  marketId: string;
  state: number;
  reserves: string[];
  probabilities: number[];
  kSquared: string;
  totalMinted: string;
}

export interface WsTradeExecutedData {
  marketId: string;
  trader: string;
  isBuy: boolean;
  collateralAmount: string;
  tokensTransacted: string;
  feePaid: string;
  outcomeIndex: number | null;
  mu: number | null;
  sigma: number | null;
}

export interface WsPriceUpdateData {
  marketId: string;
  probabilities: number[];
}

export interface WsLiquidityUpdateData {
  marketId: string;
  isAdd: boolean;
  collateralAmount: string;
  sharesChanged: string;
  lpSharesTotal: string;
}

// ── Error Response ─────────────────────────────────────────────────────

export interface ApiErrorResponse {
  statusCode: number;
  message: string;
  error: string;
  /** Optional machine-readable error code for frontend handling. */
  code?: string;
}
