/// Fixed-point arithmetic primitives for the DekantPM AMM.
///
/// Convention:
///   - Token amounts: raw u64 in collateral-native precision (USDC = 10^6).
///   - Probability weights and ratios: u128 scaled by SCALE (10^9).
///   - Squared values (k_squared, sum_of_squares): u128 unscaled.
///
/// All functions return Result<T, ProgramError> using checked arithmetic
/// to prevent overflow. Implementation in task P-2.

use crate::constants::SCALE;

/// Multiply two SCALE-denominated values: result = a * b / SCALE.
pub fn scaled_mul(a: u128, b: u128) -> Option<u128> {
    a.checked_mul(b)?.checked_div(SCALE)
}

/// Divide with SCALE precision: result = a * SCALE / b.
pub fn scaled_div(a: u128, b: u128) -> Option<u128> {
    if b == 0 {
        return None;
    }
    a.checked_mul(SCALE)?.checked_div(b)
}

/// Ceiling division: ⌈a / b⌉.
pub fn div_ceil(a: u128, b: u128) -> Option<u128> {
    if b == 0 {
        return None;
    }
    Some(a.checked_add(b.checked_sub(1)?)?.checked_div(b)?)
}

/// Floor division: ⌊a / b⌋.
pub fn div_floor(a: u128, b: u128) -> Option<u128> {
    if b == 0 {
        return None;
    }
    a.checked_div(b)
}

/// Compute a * b / c without intermediate overflow where possible.
/// Uses u128 throughout. Caller is responsible for ensuring a*b fits in u128.
pub fn mul_div(a: u128, b: u128, c: u128) -> Option<u128> {
    if c == 0 {
        return None;
    }
    a.checked_mul(b)?.checked_div(c)
}

/// Compute a * b / c, rounding up.
pub fn mul_div_ceil(a: u128, b: u128, c: u128) -> Option<u128> {
    if c == 0 {
        return None;
    }
    let numerator = a.checked_mul(b)?;
    div_ceil(numerator, c)
}
