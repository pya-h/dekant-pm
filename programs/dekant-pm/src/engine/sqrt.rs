use ethnum::U256;

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

/// Integer square root for U256 via Newton's method.
///
/// Returns ⌊√n⌋ as u128. Caller must ensure result fits u128
/// (true for our discriminant since it maps back to token amounts).
pub fn isqrt_u256(n: U256) -> u128 {
    if n == U256::ZERO {
        return 0;
    }
    if n <= U256::from(1u128) {
        return 1;
    }

    let mut x = n / 2 + 1;
    loop {
        let y = (x + n / x) / 2;
        if y >= x {
            return x.as_u128();
        }
        x = y;
    }
}
