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

    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
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
