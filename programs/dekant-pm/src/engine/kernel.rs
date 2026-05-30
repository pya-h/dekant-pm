/// Smooth settlement kernel for continuous markets.
///
/// Pure-math module — no Anchor context, no account access. Wired into
/// `resolve_market` and `claim_payout` in Phase 4. Until then, callers
/// don't exist and existing behavior is unchanged.
///
/// All bin weights and the scaling factor are SCALE-denominated (10^9).
/// `kernel_width == 0` produces exact winner-take-all (only `win` gets
/// non-zero weight), preserving the legacy resolution model for any market
/// that opts out (and for every account migrated from schema v1, whose
/// `kernel_width` deserializes from zero padding).
use anchor_lang::prelude::*;

use crate::constants::SCALE;
use crate::errors::DekantPmError;

/// Triangular kernel weight for bin `i` given winning bin `win` and width `w`.
///
/// Mathematical form: `K(i, win, w) = max(0, 1 - |i - win| / (w + 1))`.
///
/// Returned as a SCALE-denominated `u128` in `[0, SCALE]`:
///   - `K(win, win, w) = SCALE` (the peak is always 1.0)
///   - `K(i, win, 0) = 0` for `i != win` (pure WTA when `w = 0`)
///   - `K(i, win, w) = 0` for `|i - win| > w` (compact support)
///   - `K(i, win, w) = SCALE / (w + 1)` at the tail (`|i - win| = w`)
///
/// Overflow: `SCALE * (w + 1) <= 10^9 * (u16::MAX + 1) < 2^46`, well within u128.
/// No checked arithmetic needed — the function is total over its input domain.
pub fn kernel_weight(i: usize, win: usize, w: u16) -> u128 {
    let d = i.abs_diff(win) as u128;
    let w128 = w as u128;
    if d > w128 {
        return 0;
    }
    // K = SCALE * (w + 1 - d) / (w + 1).  Numerator is bounded above; both
    // arithmetic ops are exact in u128 for any realistic kernel width.
    let denom = w128 + 1;
    let num = SCALE * (denom - d);
    num / denom
}

/// Compute the solvency scaling factor for a resolved continuous market.
///
/// Inputs:
///   - `trader_token_totals[i]`: aggregate trader holdings in bin `i` at
///     resolution time (frozen by `freeze_trader_token_totals_for_resolution`)
///   - `win`: resolved outcome bin index
///   - `w`: market's kernel width
///   - `total_minted`: AMM `total_minted` at resolution (the collateral pool
///     that backs all trader claims)
///
/// Returns `(scaling_factor, total_raw_claims)` where:
///   - `total_raw_claims = Σ_i trader_token_totals[i] * K(i, win, w) / SCALE`
///   - `scaling_factor = min(SCALE, total_minted * SCALE / total_raw_claims)`
///
/// Semantics:
///   - `total_raw_claims == 0` (no traders, or all holdings outside kernel)
///     → returns `(SCALE, 0)` — no scaling needed, full LP residual.
///   - `total_raw_claims <= total_minted` → scaling factor caps at SCALE
///     (no dilution; LP keeps the surplus as residual).
///   - `total_raw_claims > total_minted` → scaling factor < SCALE; trader
///     payouts are proportionally diluted so the vault stays solvent.
pub fn compute_scaling_factor(
    trader_token_totals: &[u64],
    win: usize,
    w: u16,
    total_minted: u128,
) -> Result<(u64, u128)> {
    let total_raw_claims = raw_claims(trader_token_totals, win, w)?;

    if total_raw_claims == 0 {
        // No claims to scale. Return SCALE so downstream math (`raw * sf / SCALE`)
        // is a no-op, and 0 raw so callers know the LP residual is the full pool.
        return Ok((SCALE as u64, 0));
    }

    let sf_u128 = total_minted
        .checked_mul(SCALE)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))?
        / total_raw_claims;

    // Cap at SCALE so we never *inflate* trader payouts above their raw share.
    let capped = sf_u128.min(SCALE);
    // SCALE = 10^9 fits in u64; cap guarantees the cast is lossless.
    Ok((capped as u64, total_raw_claims))
}

/// Compute the kernel-weighted gross payout for a single trader's position.
///
/// `payout = (Σ_i holdings[i] * K(i, win, w) / SCALE) * scaling_factor / SCALE`
///
/// The aggregate-then-scale form (sum first, then apply `scaling_factor` once)
/// avoids compounding per-bin flooring error. Returns 0 for a position with
/// no holdings inside the kernel's support — the caller is responsible for
/// translating that into a `NothingToClaim` error if appropriate.
pub fn compute_kernel_payout(
    holdings: &[u64],
    win: usize,
    w: u16,
    scaling_factor: u64,
) -> Result<u128> {
    let raw = raw_claims(holdings, win, w)?;
    raw.checked_mul(scaling_factor as u128)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))?
        .checked_div(SCALE)
        .ok_or_else(|| error!(DekantPmError::MathOverflow))
}

/// Σ_i (tokens[i] * K(i, win, w) / SCALE), with overflow checks.
///
/// Shared core for `compute_scaling_factor` and `compute_kernel_payout`.
/// Each term: u64 (≤ 2^64) × SCALE (~2^30) ≈ 2^94, well inside u128. Across
/// MAX_OUTCOMES=256 bins the sum stays far below u128::MAX; the `checked_*`
/// calls are defensive against future changes to MAX_OUTCOMES or trader-size
/// assumptions.
fn raw_claims(tokens: &[u64], win: usize, w: u16) -> Result<u128> {
    let mut total: u128 = 0;
    for (i, &t) in tokens.iter().enumerate() {
        let weight = kernel_weight(i, win, w);
        if weight == 0 || t == 0 {
            continue;
        }
        let contribution = (t as u128)
            .checked_mul(weight)
            .ok_or_else(|| error!(DekantPmError::MathOverflow))?
            / SCALE;
        total = total
            .checked_add(contribution)
            .ok_or_else(|| error!(DekantPmError::MathOverflow))?;
    }
    Ok(total)
}
