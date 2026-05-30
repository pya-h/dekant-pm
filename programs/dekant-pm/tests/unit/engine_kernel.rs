use dekant_pm::constants::SCALE;
use dekant_pm::engine::kernel::{compute_kernel_payout, compute_scaling_factor, kernel_weight};

const S: u128 = SCALE; // 1_000_000_000

// ── kernel_weight ───────────────────────────────────────────────────────

#[test]
fn test_kernel_weight_wta_when_w_zero() {
    // P3-2 case 1: W=0 collapses to winner-take-all.
    assert_eq!(kernel_weight(5, 5, 0), S);
    for i in 0..8 {
        if i != 5 {
            assert_eq!(kernel_weight(i, 5, 0), 0, "i={i} must be 0 under WTA");
        }
    }
}

#[test]
fn test_kernel_weight_triangular_shape_w3() {
    // P3-2 case 2: W=3, win=5 — explicit triangular shape.
    // K(d, W=3) = SCALE * (4 - d) / 4 for d in [0,3], else 0.
    assert_eq!(kernel_weight(5, 5, 3), S);             // d=0 → 1.0
    assert_eq!(kernel_weight(4, 5, 3), S * 3 / 4);     // d=1 → 0.75
    assert_eq!(kernel_weight(6, 5, 3), S * 3 / 4);
    assert_eq!(kernel_weight(3, 5, 3), S * 2 / 4);     // d=2 → 0.50
    assert_eq!(kernel_weight(7, 5, 3), S * 2 / 4);
    assert_eq!(kernel_weight(2, 5, 3), S * 1 / 4);     // d=3 → 0.25
    assert_eq!(kernel_weight(8, 5, 3), S * 1 / 4);
    assert_eq!(kernel_weight(1, 5, 3), 0);              // d=4 → 0
    assert_eq!(kernel_weight(9, 5, 3), 0);

    // Symmetry around the peak.
    for d in 0..=10usize {
        let left = if d <= 5 { Some(5 - d) } else { None };
        let right = 5 + d;
        if let Some(l) = left {
            assert_eq!(
                kernel_weight(l, 5, 3),
                kernel_weight(right, 5, 3),
                "asymmetric at d={d}"
            );
        }
    }
}

#[test]
fn test_kernel_weight_left_boundary() {
    // P3-2 case 3: win=0 — left tail is naturally truncated (no i < 0).
    // Right tail is full: K(d=0..=W) > 0; K(d=W+1) = 0.
    let w: u16 = 3;
    assert_eq!(kernel_weight(0, 0, w), S);             // d=0 → 1.0
    assert_eq!(kernel_weight(1, 0, w), S * 3 / 4);     // d=1
    assert_eq!(kernel_weight(2, 0, w), S * 2 / 4);     // d=2
    assert_eq!(kernel_weight(3, 0, w), S * 1 / 4);     // d=3 (tail)
    assert_eq!(kernel_weight(4, 0, w), 0);              // d=4 (outside)
}

#[test]
fn test_kernel_weight_right_boundary() {
    // P3-2 case 4: win=N-1 — right tail naturally truncated.
    let w: u16 = 3;
    let n_minus_1 = 15usize;
    assert_eq!(kernel_weight(15, n_minus_1, w), S);
    assert_eq!(kernel_weight(14, n_minus_1, w), S * 3 / 4);
    assert_eq!(kernel_weight(13, n_minus_1, w), S * 2 / 4);
    assert_eq!(kernel_weight(12, n_minus_1, w), S * 1 / 4);
    assert_eq!(kernel_weight(11, n_minus_1, w), 0);
    // bins above N-1 don't exist in real markets, but the math is still total.
    assert_eq!(kernel_weight(16, n_minus_1, w), S * 3 / 4);
}

#[test]
fn test_kernel_weight_w_exceeds_num_bins() {
    // P3-2 case 5: W >= N — every bin within W of win gets weight.
    // create_market validates W < num_outcomes, but the math fn must still
    // behave sensibly (no panic, monotonic falloff).
    let w: u16 = 10;
    let win: usize = 4;
    // All 8 bins (0..8) are within distance 10 from win=4, so all > 0.
    for i in 0..8 {
        let d = (i as i32 - win as i32).unsigned_abs() as u128;
        let expected = S * (11 - d) / 11;
        assert_eq!(kernel_weight(i, win, w), expected, "bin {i}");
        assert!(kernel_weight(i, win, w) > 0);
    }
}

#[test]
fn test_kernel_weight_peak_always_scale() {
    // K(win, win, w) = SCALE for any w. This is the contract for the payout
    // math: the winning bin always credits at 1:1 (before scaling factor).
    for w in 0u16..=255 {
        for win in 0..32usize {
            assert_eq!(kernel_weight(win, win, w), S, "peak failed at win={win} w={w}");
        }
    }
}

// ── compute_scaling_factor ─────────────────────────────────────────────

#[test]
fn test_scaling_factor_no_traders() {
    // P3-2 case 6: no holdings → no claims → sf=SCALE, raw=0.
    // The SCALE return means downstream payout math is a no-op for any
    // (hypothetical) trader that later appears with zero holdings.
    let tt = vec![0u64; 16];
    let (sf, raw) = compute_scaling_factor(&tt, 8, 3, 1_000_000_000_000).unwrap();
    assert_eq!(sf, SCALE as u64);
    assert_eq!(raw, 0);
}

#[test]
fn test_scaling_factor_claims_less_than_total_minted() {
    // P3-2 case 7: total raw claims < total_minted → sf capped at SCALE
    // (no dilution, LP keeps the surplus).
    // 16 bins, win=8, W=3. Only bin 8 has holdings (1000), so raw = 1000.
    let mut tt = vec![0u64; 16];
    tt[8] = 1000;
    let total_minted = 10_000u128;
    let (sf, raw) = compute_scaling_factor(&tt, 8, 3, total_minted).unwrap();
    assert_eq!(raw, 1000);
    assert_eq!(sf, SCALE as u64); // capped
}

#[test]
fn test_scaling_factor_claims_greater_than_total_minted() {
    // P3-2 case 8: insolvency averted via dilution.
    // raw claims = 10_000 (bin 8 only), tm = 5_000 → sf = 5_000 * SCALE / 10_000 = SCALE/2.
    let mut tt = vec![0u64; 16];
    tt[8] = 10_000;
    let total_minted = 5_000u128;
    let (sf, raw) = compute_scaling_factor(&tt, 8, 3, total_minted).unwrap();
    assert_eq!(raw, 10_000);
    assert_eq!(sf, (SCALE / 2) as u64);
}

#[test]
fn test_scaling_factor_claims_equal_total_minted() {
    // P3-2 case 9: exact-fit edge case → sf=SCALE, no dilution, no surplus.
    let mut tt = vec![0u64; 16];
    tt[8] = 1_000_000;
    let total_minted = 1_000_000u128;
    let (sf, raw) = compute_scaling_factor(&tt, 8, 3, total_minted).unwrap();
    assert_eq!(raw, 1_000_000);
    assert_eq!(sf, SCALE as u64);
}

#[test]
fn test_scaling_factor_wta_mode_matches_legacy() {
    // W=0 must reproduce legacy WTA accounting: raw = trader_token_totals[win],
    // since all other bins get weight 0.
    let tt: Vec<u64> = (1..=16).collect(); // 1..16
    let win = 5usize;
    let (sf, raw) = compute_scaling_factor(&tt, win, 0, 1_000_000).unwrap();
    assert_eq!(raw, tt[win] as u128);
    assert_eq!(sf, SCALE as u64);
}

#[test]
fn test_scaling_factor_spread_holdings_weighted_sum() {
    // Holdings spread across bins 6..=10 with win=8, W=2.
    // Weights: d=0→SCALE, d=1→floor(SCALE*2/3)=666_666_666,
    //          d=2→floor(SCALE/3)=333_333_333, d>=3→0.
    // Per-bin contribution = floor(t * weight / SCALE), so flooring happens
    // twice (in the weight itself and in the contribution). Real values:
    //   tt[6] d=2: 300 * 333_333_333 / SCALE = 99   (lost 1 unit to floor)
    //   tt[7] d=1: 600 * 666_666_666 / SCALE = 399  (lost 1)
    //   tt[8] d=0: 900                              (exact)
    //   tt[9] d=1: 399
    //   tt[10] d=2: 99
    // raw = 99 + 399 + 900 + 399 + 99 = 1896 (mathematical ideal 1900, lost 4 to flooring).
    let mut tt = vec![0u64; 16];
    tt[6] = 300;
    tt[7] = 600;
    tt[8] = 900;
    tt[9] = 600;
    tt[10] = 300;
    let (sf, raw) = compute_scaling_factor(&tt, 8, 2, 10_000).unwrap();
    assert_eq!(raw, 1896);
    assert_eq!(sf, SCALE as u64);
}

// ── compute_kernel_payout ──────────────────────────────────────────────

#[test]
fn test_payout_single_bin_position_at_win() {
    // P3-2 case 10: a trader holding only the winning bin gets full payout.
    let mut h = vec![0u64; 16];
    h[8] = 5_000;
    let payout = compute_kernel_payout(&h, 8, 3, SCALE as u64).unwrap();
    assert_eq!(payout, 5_000);
}

#[test]
fn test_payout_spread_position_weighted_sum() {
    // P3-2 case 11: spread position with W=3.
    // Holdings at bins 7, 8, 9 with win=8.
    // K(d=0)=SCALE, K(d=1)=SCALE*3/4 (exact, since 4 | SCALE).
    // payout = 100*0.75 + 200*1.0 + 100*0.75 = 75 + 200 + 75 = 350
    let mut h = vec![0u64; 16];
    h[7] = 100;
    h[8] = 200;
    h[9] = 100;
    let payout = compute_kernel_payout(&h, 8, 3, SCALE as u64).unwrap();
    assert_eq!(payout, 350);
}

#[test]
fn test_payout_with_scaling_factor_dilutes_proportionally() {
    // P3-2 case 12: scaling_factor < SCALE dilutes every trader's payout
    // by the same ratio. Here sf=SCALE/2.
    let mut h = vec![0u64; 16];
    h[8] = 1_000;
    let half = (SCALE / 2) as u64;
    let payout = compute_kernel_payout(&h, 8, 3, half).unwrap();
    assert_eq!(payout, 500);
}

#[test]
fn test_payout_zero_holdings() {
    // P3-2 case 13: empty position → 0 payout (caller maps to NothingToClaim).
    let h = vec![0u64; 16];
    let payout = compute_kernel_payout(&h, 8, 3, SCALE as u64).unwrap();
    assert_eq!(payout, 0);
}

#[test]
fn test_payout_outside_kernel_support_is_zero() {
    // Holdings only in bins distant from win → kernel weight is 0 → payout = 0.
    let mut h = vec![0u64; 16];
    h[0] = 10_000;
    h[1] = 10_000;
    h[15] = 10_000;
    // win=8, W=3 → support is bins 5..=11. None of these holdings count.
    let payout = compute_kernel_payout(&h, 8, 3, SCALE as u64).unwrap();
    assert_eq!(payout, 0);
}

#[test]
fn test_payout_at_kernel_tail_uses_min_weight() {
    // At the kernel's outer edge (|i-win| = W), weight = SCALE/(W+1).
    // Holdings of (W+1) tokens at the tail should pay out exactly 1 token
    // after scaling — sanity that the tail isn't accidentally zero.
    let w: u16 = 4;
    let mut h = vec![0u64; 16];
    h[8 - w as usize] = (w as u64) + 1; // tail bin, 5 tokens
    let payout = compute_kernel_payout(&h, 8, w, SCALE as u64).unwrap();
    assert_eq!(payout, 1);
}

#[test]
fn test_payout_consistent_with_legacy_wta() {
    // W=0 + sf=SCALE → payout collapses to holdings[win] exactly.
    let mut h = vec![0u64; 16];
    h[3] = 7_777;
    let payout = compute_kernel_payout(&h, 3, 0, SCALE as u64).unwrap();
    assert_eq!(payout, 7_777);
}

// ── Solvency invariant ─────────────────────────────────────────────────

/// P3-2 case 14: across many configurations, the aggregate scaled trader
/// claims must never exceed `total_minted`. This is the core safety property
/// of the scaling factor — if it ever broke, the vault would go insolvent.
///
/// "Fuzz" is implemented as a deterministic sweep over a representative
/// matrix of (num_bins, kernel_width, holdings_pattern, total_minted)
/// configurations — gives the same coverage as `rand` without adding a
/// dev-dependency.
#[test]
fn test_solvency_invariant_aggregate_payout_le_total_minted() {
    let bin_counts = [2usize, 4, 8, 16, 32];
    let widths = [0u16, 1, 2, 3, 5, 7, 15];
    // Each pattern is a closure producing trader_token_totals of length n.
    let patterns: Vec<fn(usize) -> Vec<u64>> = vec![
        // All-equal distribution
        |n| vec![1_000; n],
        // Peaked at center
        |n| (0..n).map(|i| if i == n / 2 { 10_000 } else { 100 }).collect(),
        // Heavy at boundaries
        |n| (0..n).map(|i| if i == 0 || i == n - 1 { 5_000 } else { 50 }).collect(),
        // Linear ramp
        |n| (0..n).map(|i| (i as u64 + 1) * 100).collect(),
        // Sparse: only every other bin
        |n| (0..n).map(|i| if i % 2 == 0 { 2_000 } else { 0 }).collect(),
        // Empty (degenerate)
        |n| vec![0; n],
    ];

    let mut tested = 0;
    for &n in &bin_counts {
        for &w in &widths {
            // The on-chain validator enforces w < num_outcomes; mirror that
            // here. (Larger W is mathematically defined but never exercised.)
            if w as usize >= n {
                continue;
            }
            for pat in &patterns {
                let tt = pat(n);
                let raw_total: u128 = tt.iter().map(|&x| x as u128).sum();
                // Pick three total_minted regimes: way above, ~equal, way below
                // the raw claim sum, exercising the cap and the dilution paths.
                let tm_choices: [u128; 3] = [
                    raw_total.saturating_mul(10).max(1),
                    raw_total.max(1),
                    raw_total / 4 + 1,
                ];
                for &tm in &tm_choices {
                    for win in 0..n {
                        let (sf, _raw) = compute_scaling_factor(&tt, win, w, tm).unwrap();
                        // LP residual = total_minted - aggregate scaled claims;
                        // call compute_kernel_payout on trader_token_totals
                        // directly (no dedicated wrapper — same arithmetic).
                        let scaled = compute_kernel_payout(&tt, win, w, sf).unwrap();
                        assert!(
                            scaled <= tm,
                            "solvency violated: scaled={scaled} > tm={tm} \
                             (n={n} w={w} win={win} sf={sf})"
                        );
                        // Aggregate payout floor: if any claims exist and
                        // scaling kicked in (sf<SCALE), scaled should equal tm
                        // up to floor-1 (sum was exactly tm, then floor).
                        if sf < SCALE as u64 && scaled > 0 {
                            // tm - scaled is the rounding leftover; must be
                            // strictly less than the number of contributing
                            // bins (each contributes at most 1 unit of floor).
                            let leftover = tm - scaled;
                            let contributing = tt.iter().enumerate()
                                .filter(|(i, &t)| t > 0 && kernel_weight(*i, win, w) > 0)
                                .count() as u128;
                            assert!(
                                leftover <= contributing.max(1),
                                "rounding leftover too large: tm={tm} scaled={scaled} \
                                 leftover={leftover} contributing={contributing}"
                            );
                        }
                        tested += 1;
                    }
                }
            }
        }
    }
    assert!(tested > 500, "expected wide coverage, only ran {tested}");
}

#[test]
fn test_scaling_factor_caps_at_scale_when_raw_is_tiny() {
    // Degenerate sanity: tiny raw claims vs huge total_minted must not produce
    // sf > SCALE (which would let traders claim more than they hold pre-scaling).
    let mut tt = vec![0u64; 16];
    tt[5] = 1;
    let (sf, _raw) = compute_scaling_factor(&tt, 5, 3, u64::MAX as u128).unwrap();
    assert_eq!(sf, SCALE as u64);
}
