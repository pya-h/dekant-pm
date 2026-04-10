use umbra::engine::fixed_point::*;
use umbra::constants::SCALE;

// ── scaled_mul ──────────────────────────────────────────────────

#[test]
fn test_scaled_mul_identity() {
    assert_eq!(scaled_mul(SCALE, SCALE), Some(SCALE));
}

#[test]
fn test_scaled_mul_half() {
    assert_eq!(scaled_mul(SCALE, SCALE / 2), Some(SCALE / 2));
}

#[test]
fn test_scaled_mul_zero() {
    assert_eq!(scaled_mul(0, SCALE), Some(0));
    assert_eq!(scaled_mul(SCALE, 0), Some(0));
}

#[test]
fn test_scaled_mul_overflow() {
    assert_eq!(scaled_mul(u128::MAX, u128::MAX), None);
}

#[test]
fn test_scaled_mul_large_values() {
    let a = 1_000_000_000_000u128; // 10^12
    assert_eq!(scaled_mul(a, SCALE), Some(a));
}

// ── scaled_div ──────────────────────────────────────────────────

#[test]
fn test_scaled_div_identity() {
    assert_eq!(scaled_div(500, 500), Some(SCALE));
}

#[test]
fn test_scaled_div_half() {
    assert_eq!(scaled_div(1, 2), Some(SCALE / 2));
}

#[test]
fn test_scaled_div_by_zero() {
    assert_eq!(scaled_div(100, 0), None);
}

#[test]
fn test_scaled_div_zero_numerator() {
    assert_eq!(scaled_div(0, 100), Some(0));
}

#[test]
fn test_scaled_div_overflow() {
    assert_eq!(scaled_div(u128::MAX, 1), None);
}

// ── div_ceil ────────────────────────────────────────────────────

#[test]
fn test_div_ceil_exact() {
    assert_eq!(div_ceil(10, 5), Some(2));
}

#[test]
fn test_div_ceil_rounds_up() {
    assert_eq!(div_ceil(11, 5), Some(3));
    assert_eq!(div_ceil(1, 3), Some(1));
}

#[test]
fn test_div_ceil_by_zero() {
    assert_eq!(div_ceil(10, 0), None);
}

#[test]
fn test_div_ceil_zero_numerator() {
    assert_eq!(div_ceil(0, 5), Some(0));
}

#[test]
fn test_div_ceil_one_over_one() {
    assert_eq!(div_ceil(1, 1), Some(1));
    // u128::MAX / u128::MAX would be 1, but the formula (a + b - 1) overflows.
    assert_eq!(div_ceil(u128::MAX, u128::MAX), None);
}

// ── div_floor ───────────────────────────────────────────────────

#[test]
fn test_div_floor_exact() {
    assert_eq!(div_floor(10, 5), Some(2));
}

#[test]
fn test_div_floor_truncates() {
    assert_eq!(div_floor(11, 5), Some(2));
}

#[test]
fn test_div_floor_by_zero() {
    assert_eq!(div_floor(10, 0), None);
}

// ── mul_div ─────────────────────────────────────────────────────

#[test]
fn test_mul_div_basic() {
    assert_eq!(mul_div(100, 200, 50), Some(400));
}

#[test]
fn test_mul_div_by_zero() {
    assert_eq!(mul_div(100, 200, 0), None);
}

#[test]
fn test_mul_div_precision() {
    // 333 * 333 / 1000 = 110889 / 1000 = 110 (floor)
    assert_eq!(mul_div(333, 333, 1000), Some(110));
}

#[test]
fn test_mul_div_overflow() {
    assert_eq!(mul_div(u128::MAX, 2, 1), None);
}

#[test]
fn test_mul_div_zero_numerator() {
    assert_eq!(mul_div(0, 100, 50), Some(0));
}

// ── mul_div_ceil ────────────────────────────────────────────────

#[test]
fn test_mul_div_ceil_rounds_up() {
    // 333 * 333 / 1000 = 110.889 → ceil to 111
    assert_eq!(mul_div_ceil(333, 333, 1000), Some(111));
}

#[test]
fn test_mul_div_ceil_exact() {
    assert_eq!(mul_div_ceil(100, 200, 50), Some(400));
}

#[test]
fn test_mul_div_ceil_by_zero() {
    assert_eq!(mul_div_ceil(100, 200, 0), None);
}
