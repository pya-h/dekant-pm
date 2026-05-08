import {
  MarketType,
  MarketState,
  type MarketSummary,
  type UserPosition,
} from "@/lib/types";

/**
 * Binary market — satisfies L2-norm invariant: Σ x[i]² = totalMinted².
 * Pythagorean triple (3,4,5) × 5M: x=[15M,20M], k=25M.
 * Probabilities: Yes = 36%, No = 64%.
 */
export const mockBinaryMarket: MarketSummary = {
  id: "1",
  pubkey: "4GYvtbs7da26tLaZt9PNQWLesq2riwEN6fi9tGF91A5P",
  marketType: MarketType.Binary,
  state: MarketState.Active,
  creator: "Creator1111111111111111111111111111111111111",
  oracle: "Oracle11111111111111111111111111111111111111",
  collateralMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  deadline: new Date(Date.now() + 86_400_000).toISOString(),
  createdAt: new Date().toISOString(),
  resolvedAt: null,
  numOutcomes: 2,
  title: "Will BTC reach $100k?",
  description: "Binary prediction market",
  category: "Crypto",
  subject: "BTC",
  tags: ["btc", "price"],
  icon: null,
  outcomeLabels: ["Yes", "No"],
  // x[0]=15M, x[1]=20M → reserves = totalMinted - x
  reserves: ["10000000", "5000000"],
  kSquared: "625000000000000",
  totalMinted: "25000000",
  totalVolume: "5000000000",
  totalTraders: 42,
  lastTradeAt: new Date().toISOString(),
  rangeMin: null,
  rangeMax: null,
  resolvedOutcome: null,
  resolvedValue: null,
  lpSharesTotal: "0",
  lpFeeAccumulated: "0",
  protocolFeeAccumulated: "0",
};

/** Multi-outcome market with 3 outcomes. */
export const mockMultiMarket: MarketSummary = {
  ...mockBinaryMarket,
  id: "2",
  marketType: MarketType.MultiOutcome,
  numOutcomes: 3,
  title: "Who wins the election?",
  category: "Politics",
  outcomeLabels: ["Alice", "Bob", "Charlie"],
  reserves: ["40", "60", "50"],
  totalMinted: "100",
  kSquared: "7700",
};

/** Continuous market with 10 bins over range [0, 100]. */
export const mockContinuousMarket: MarketSummary = {
  ...mockBinaryMarket,
  id: "3",
  marketType: MarketType.Continuous,
  numOutcomes: 10,
  title: "What will BTC price be?",
  outcomeLabels: null,
  reserves: ["90", "85", "80", "70", "60", "60", "70", "80", "85", "90"],
  totalMinted: "100",
  kSquared: "6450",
  rangeMin: "0",
  rangeMax: "100000000000", // 100 * SCALE
};

/** Resolved binary market. */
export const mockResolvedMarket: MarketSummary = {
  ...mockBinaryMarket,
  id: "4",
  state: MarketState.Resolved,
  resolvedAt: new Date().toISOString(),
  resolvedOutcome: 0,
};

/** User position in the binary market. */
export const mockUserPosition: UserPosition = {
  id: "pos-1",
  marketId: "1",
  market: mockBinaryMarket,
  userAddress: "4GYvtbs7da26tLaZt9PNQWLesq2riwEN6fi9tGF91A5P",
  holdings: ["10000000", "5000000"], // 10 Yes, 5 No tokens
  totalDeposited: "12000000",
  totalWithdrawn: "0",
  claimed: false,
  updatedAt: new Date().toISOString(),
};
