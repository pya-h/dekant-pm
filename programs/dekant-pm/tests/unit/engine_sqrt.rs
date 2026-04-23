use dekant_pm::engine::sqrt::{isqrt, isqrt_u256};
use ethnum::U256;

#[test]
fn test_isqrt_small() {
    assert_eq!(isqrt(0), 0);
    assert_eq!(isqrt(1), 1);
    assert_eq!(isqrt(2), 1);
    assert_eq!(isqrt(3), 1);
    assert_eq!(isqrt(4), 2);
    assert_eq!(isqrt(9), 3);
    assert_eq!(isqrt(100), 10);
    assert_eq!(isqrt(99), 9);
    assert_eq!(isqrt(101), 10);
}

#[test]
fn test_isqrt_large() {
    // 10^24: sqrt = 10^12
    assert_eq!(isqrt(1_000_000_000_000_000_000_000_000u128), 1_000_000_000_000u128);
}

#[test]
fn test_isqrt_max() {
    // Should not panic on u128::MAX
    let result = isqrt(u128::MAX);
    assert!(result * result <= u128::MAX);
}

#[test]
fn test_isqrt_perfect_squares() {
    let perfect_squares: Vec<u128> = vec![
        1, 4, 9, 16, 25, 36, 49, 64, 81, 100,
        10_000, 1_000_000, 1_000_000_000_000,
        (1u128 << 64), // 2^64 is a perfect square? No, but let's test floor.
    ];
    for &n in &perfect_squares[..perfect_squares.len() - 1] {
        let r = isqrt(n);
        assert_eq!(r * r, n, "isqrt({n}) = {r}, but {r}² = {}", r * r);
    }
}

#[test]
fn test_isqrt_non_perfect_squares_floor() {
    // Non-perfect squares should return floor(sqrt(n)).
    let cases: Vec<(u128, u128)> = vec![
        (2, 1),
        (3, 1),
        (5, 2),
        (8, 2),
        (10, 3),
        (15, 3),
        (26, 5),
        (99, 9),
        (101, 10),
    ];
    for (n, expected) in cases {
        let r = isqrt(n);
        assert_eq!(r, expected, "isqrt({n}) = {r}, expected {expected}");
    }
}

#[test]
fn test_isqrt_precision_invariant() {
    // For a range of values, verify: result² ≤ n < (result+1)²
    let test_values: Vec<u128> = vec![
        0, 1, 2, 3, 7, 15, 16, 17, 255, 256, 257,
        999_999, 1_000_000, 1_000_001,
        999_999_999, 1_000_000_000, 1_000_000_001,
        999_999_999_999, 1_000_000_000_000, 1_000_000_000_001,
        u128::MAX / 2, u128::MAX,
    ];
    for &n in &test_values {
        let r = isqrt(n);
        assert!(
            r.checked_mul(r).map_or(false, |sq| sq <= n),
            "isqrt({n}) = {r}: r² > n"
        );
        if r < u128::MAX {
            let next = r + 1;
            // (r+1)² should be > n (or overflow, which means r is correct).
            match next.checked_mul(next) {
                Some(sq) => assert!(sq > n, "isqrt({n}) = {r}: (r+1)² = {sq} ≤ n"),
                None => {} // overflow means (r+1)² > u128::MAX ≥ n, correct.
            }
        }
    }
}

#[test]
fn test_isqrt_intermediate_ranges() {
    // 10^6
    assert_eq!(isqrt(1_000_000), 1_000);
    // 10^9
    assert_eq!(isqrt(1_000_000_000), 31_622); // floor(sqrt(10^9)) = 31622
    // 10^12
    assert_eq!(isqrt(1_000_000_000_000), 1_000_000);
    // 10^18
    assert_eq!(isqrt(1_000_000_000_000_000_000), 1_000_000_000);
}

// ── isqrt_u256 tests ─────────────────────────────────────────────

#[test]
fn test_isqrt_u256_small() {
    assert_eq!(isqrt_u256(U256::ZERO), 0);
    assert_eq!(isqrt_u256(U256::from(1u128)), 1);
    assert_eq!(isqrt_u256(U256::from(2u128)), 1);
    assert_eq!(isqrt_u256(U256::from(3u128)), 1);
    assert_eq!(isqrt_u256(U256::from(4u128)), 2);
    assert_eq!(isqrt_u256(U256::from(9u128)), 3);
    assert_eq!(isqrt_u256(U256::from(100u128)), 10);
    assert_eq!(isqrt_u256(U256::from(99u128)), 9);
    assert_eq!(isqrt_u256(U256::from(101u128)), 10);
}

#[test]
fn test_isqrt_u256_agrees_with_isqrt_u128() {
    // For values that fit in u128, isqrt_u256 must return the same result as isqrt.
    let values: Vec<u128> = vec![
        0, 1, 2, 3, 4, 7, 9, 15, 16, 17, 100, 101,
        1_000_000, 1_000_000_000, 1_000_000_000_000,
        1_000_000_000_000_000_000,
        1_000_000_000_000_000_000_000_000, // 10^24
        u128::MAX / 2, u128::MAX,
    ];
    for &n in &values {
        assert_eq!(
            isqrt_u256(U256::from(n)),
            isqrt(n),
            "isqrt_u256 disagrees with isqrt for n={n}"
        );
    }
}

#[test]
fn test_isqrt_u256_large_beyond_u128() {
    // Values above u128::MAX that represent realistic discriminant values.
    // xw = 2.12e19 (SCALE-weighted position), xw² ≈ 4.5e38 > u128::MAX (3.4e38).
    // This is exactly the BUG-001 overflow case.
    let xw = U256::from(21_213_203_435_000_000_000u128); // ~2.12e19
    let xw_sq = xw * xw; // ~4.5e38, overflows u128
    let r = isqrt_u256(xw_sq);
    // isqrt(xw²) should == xw (perfect square)
    assert_eq!(r, 21_213_203_435_000_000_000u128);
}

#[test]
fn test_isqrt_u256_precision_invariant() {
    // r² ≤ n < (r+1)² for various U256 values including ones beyond u128.
    let xw = U256::from(21_213_203_435_000_000_000u128);
    let w2_excess = U256::from(30_000_000_000_000_000_000_000_000_000_000_000u128); // 3e34
    let test_values: Vec<U256> = vec![
        U256::ZERO,
        U256::from(1u128),
        U256::from(u128::MAX),
        xw * xw,                   // ~4.5e38 (BUG-001 case)
        xw * xw + w2_excess,       // discriminant = xw² + w2·excess
        xw * xw + U256::from(1u128), // off-by-one from perfect square
        xw * xw - U256::from(1u128), // off-by-one below perfect square
    ];
    for n in &test_values {
        let r = isqrt_u256(*n);
        let r256 = U256::from(r);
        assert!(
            r256 * r256 <= *n,
            "isqrt_u256({n}): r²={} > n", r256 * r256
        );
        let next = r256 + U256::from(1u128);
        assert!(
            next * next > *n,
            "isqrt_u256({n}): (r+1)²={} ≤ n", next * next
        );
    }
}

#[test]
fn test_isqrt_u256_perfect_squares() {
    let bases: Vec<u128> = vec![
        1, 2, 3, 10, 100, 1_000_000, 1_000_000_000,
        1_000_000_000_000, // 10^12
        21_213_203_435_000_000_000, // xw from BUG-001
    ];
    for &b in &bases {
        let n = U256::from(b) * U256::from(b);
        assert_eq!(
            isqrt_u256(n), b,
            "isqrt_u256({b}²) should equal {b}"
        );
    }
}
