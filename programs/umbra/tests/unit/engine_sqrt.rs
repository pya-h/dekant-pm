use umbra::engine::sqrt::isqrt;

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
