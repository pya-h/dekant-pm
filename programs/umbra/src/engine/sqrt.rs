/// Integer square root via Newton's method.
///
/// Returns ⌊√n⌋ such that result² ≤ n < (result+1)².
/// Converges in ≤ 64 iterations for u128.
///
/// Implementation in task P-2.
pub fn isqrt(n: u128) -> u128 {
    if n == 0 {
        return 0;
    }
    if n == 1 {
        return 1;
    }

    // Initial guess: n / 2 + 1 (avoids `(n + 1) / 2` which overflows at u128::MAX).
    let mut x = n / 2 + 1;
    loop {
        let y = (x + n / x) / 2;
        if y >= x {
            return x;
        }
        x = y;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
