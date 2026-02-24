/// Integer square root via Newton's method.
///
/// Returns ⌊√n⌋ such that result² ≤ n < (result+1)².
/// Converges in ≤ 64 iterations for u128.
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
