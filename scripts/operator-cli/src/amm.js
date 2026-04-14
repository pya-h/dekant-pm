/**
 * Client-side L2-norm AMM simulation for inverse trade computation.
 *
 * Used to find the collateral needed to buy a target number of shares,
 * or the shares needed to sell for a target collateral amount.
 *
 * All math uses BigInt to match on-chain u128 precision.
 */

// ─── Integer Square Root ────────────────────────────────────────────────────

function isqrt(n) {
  if (n < 0n) throw new Error("isqrt of negative");
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

// ─── AMM Simulation (pure, non-mutating) ────────────────────────────────────

/**
 * Simulate a discrete buy. Returns tokens_out (BigInt).
 * @param {BigInt[]} reserves - market reserves as BigInt array
 * @param {BigInt} totalMinted
 * @param {number} outcome
 * @param {BigInt} effectiveCollateral - collateral after fees
 */
function simulateBuy(reserves, totalMinted, outcome, effectiveCollateral) {
  if (effectiveCollateral <= 0n) return 0n;
  const xi = totalMinted - reserves[outcome];
  let sumOthersXSq = 0n;
  for (let j = 0; j < reserves.length; j++) {
    if (j !== outcome) {
      const x = totalMinted - reserves[j];
      sumOthersXSq += x * x;
    }
  }
  const kNew = totalMinted + effectiveCollateral;
  const kNewSq = kNew * kNew;
  if (kNewSq < sumOthersXSq) return 0n;
  const xNewI = isqrt(kNewSq - sumOthersXSq);
  return xNewI > xi ? xNewI - xi : 0n;
}

/**
 * Simulate a discrete sell. Returns gross collateral_out (before fees, BigInt).
 * @param {BigInt[]} reserves - market reserves as BigInt array
 * @param {BigInt} totalMinted
 * @param {number} outcome
 * @param {BigInt} tokensIn
 */
function simulateSell(reserves, totalMinted, outcome, tokensIn) {
  if (tokensIn <= 0n) return 0n;
  const newReserve = reserves[outcome] + tokensIn;
  let kNewSq = 0n;
  for (let j = 0; j < reserves.length; j++) {
    const r = j === outcome ? newReserve : reserves[j];
    const x = totalMinted - r;
    kNewSq += x * x;
  }
  const kNew = isqrt(kNewSq);
  return totalMinted > kNew ? totalMinted - kNew : 0n;
}

// ─── Fee Helpers ────────────────────────────────────────────────────────────

function computeFee(grossAmount, tradeFeeBps) {
  return (grossAmount * BigInt(tradeFeeBps)) / 10000n;
}

function netAfterFee(grossAmount, tradeFeeBps) {
  return grossAmount - computeFee(grossAmount, tradeFeeBps);
}

// ─── Binary Search ──────────────────────────────────────────────────────────

/**
 * Find the gross collateral amount needed to buy at least `targetShares` tokens.
 * Returns gross collateral (BigInt) that the user must provide.
 */
function findCollateralForShares(reserves, totalMinted, outcome, targetShares, tradeFeeBps) {
  let lo = 1n;
  // Upper bound: start at targetShares and double until enough tokens come out
  let hi = targetShares < 1000000n ? 1000000n : targetShares;
  for (let i = 0; i < 80; i++) {
    const net = netAfterFee(hi, tradeFeeBps);
    if (net > 0n && simulateBuy(reserves, totalMinted, outcome, net) >= targetShares) break;
    hi *= 2n;
  }

  // Binary search
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const net = netAfterFee(mid, tradeFeeBps);
    const tokensOut = net > 0n ? simulateBuy(reserves, totalMinted, outcome, net) : 0n;
    if (tokensOut >= targetShares) {
      hi = mid;
    } else {
      lo = mid + 1n;
    }
  }
  return lo;
}

/**
 * Find the token amount to sell to receive at least `targetCollateral` (after fees).
 * Returns token amount (BigInt).
 */
function findTokensForCollateral(reserves, totalMinted, outcome, targetCollateral, tradeFeeBps) {
  // Max sellable = position = totalMinted - reserves[outcome]
  const maxTokens = totalMinted - reserves[outcome];
  if (maxTokens <= 0n) throw new Error("No position to sell");

  let lo = 1n;
  let hi = maxTokens;

  // Check feasibility: can selling everything meet the target?
  const maxGross = simulateSell(reserves, totalMinted, outcome, maxTokens);
  const maxNet = netAfterFee(maxGross, tradeFeeBps);
  if (maxNet < targetCollateral) {
    throw new Error(
      `Cannot receive that much. Max receivable: ~${maxNet} (selling entire position)`
    );
  }

  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const grossOut = simulateSell(reserves, totalMinted, outcome, mid);
    const netOut = netAfterFee(grossOut, tradeFeeBps);
    if (netOut >= targetCollateral) {
      hi = mid;
    } else {
      lo = mid + 1n;
    }
  }
  return lo;
}

// ─── Conversion Helpers ─────────────────────────────────────────────────────

/** Convert Anchor BN reserves array + totalMinted to BigInt for simulation. */
function toBigInts(marketData) {
  const reserves = marketData.reserves.map((r) => BigInt(r.toString()));
  const totalMinted = BigInt(marketData.totalMinted.toString());
  return { reserves, totalMinted };
}

module.exports = {
  simulateBuy,
  simulateSell,
  findCollateralForShares,
  findTokensForCollateral,
  toBigInts,
};
