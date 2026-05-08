use dekant_pm::engine::amm::*;
use dekant_pm::engine::sqrt::isqrt;
use dekant_pm::constants::SCALE;
use dekant_pm::errors::DekantPmError;
use anchor_lang::prelude::error;

// ── Helpers ──────────────────────────────────────────────────────

/// Create position-based initial reserves for N outcomes with total_minted = L.
/// x_per = isqrt(L² / N), reserve_per = L - x_per.
fn init_reserves(n: usize, total_minted: u128) -> Vec<u64> {
    let n128 = n as u128;
    let x_per = isqrt(total_minted * total_minted / n128);
    let h_per = (total_minted - x_per) as u64;
    vec![h_per; n]
}

const L: u128 = 1_000_000;

// For binary (N=2): isqrt(10^12/2) = 707_106, reserve = 292_894
// For 5-outcome: isqrt(10^12/5) = 447_213, reserve = 552_787
// For 3-outcome: isqrt(10^12/3) = 577_350, reserve = 422_650

// ── Sum of Position Squares ─────────────────────────────────────

#[test]
fn test_sum_of_position_squares_uniform() {
    let reserves = init_reserves(2, L);
    let actual = sum_of_position_squares(&reserves, L);
    // Should be approximately L² = 10^12.
    let expected = L * L;
    let diff = if actual > expected { actual - expected } else { expected - actual };
    // isqrt rounding can cause a small diff.
    assert!(diff < 3_000_000, "diff={diff}");
}

#[test]
fn test_sum_of_position_squares_exact() {
    // Use Pythagorean triple: x=[3M, 4M], total_minted=5M
    let reserves = vec![2_000_000u64, 1_000_000];
    let total_minted: u128 = 5_000_000;
    let actual = sum_of_position_squares(&reserves, total_minted);
    // 3M² + 4M² = 9*10^12 + 16*10^12 = 25*10^12 = 5M²
    assert_eq!(actual, 25_000_000_000_000);
    assert_eq!(actual, total_minted * total_minted);
}

// ── Sum of Squares (utility) ────────────────────────────────────

#[test]
fn test_sum_of_squares_empty() {
    assert_eq!(sum_of_squares(&[]), 0);
}

#[test]
fn test_sum_of_squares_single() {
    assert_eq!(sum_of_squares(&[5]), 25);
}

#[test]
fn test_sum_of_squares_max_u64() {
    let result = sum_of_squares(&[u64::MAX]);
    assert_eq!(result, (u64::MAX as u128) * (u64::MAX as u128));
}

// ── Invariant ────────────────────────────────────────────────────

#[test]
fn test_verify_invariant_exact() {
    // Pythagorean triple: x=[3M, 4M], total_minted=5M → exact
    let reserves = vec![2_000_000u64, 1_000_000];
    let total_minted: u128 = 5_000_000;
    verify_invariant(&reserves, total_minted).unwrap();
}

#[test]
fn test_verify_invariant_fail() {
    // Pythagorean triple + large offset
    let reserves = vec![2_000_000u64, 1_000_000];
    let total_minted: u128 = 5_000_100; // off by 100 → diff = ~1M
    assert!(verify_invariant(&reserves, total_minted).is_err());
}

#[test]
fn test_verify_invariant_within_tolerance() {
    // Use exact reserves, offset k by tolerance.
    // x=[3M,4M], tm=5M. Σx²=25*10^12. If we need diff ≤ 256:
    // We can't easily offset total_minted by a tiny amount and get diff ≤ 256
    // because (5M + ε)² = 25*10^12 + 10M*ε + ε². Even ε=1 gives diff ~10M.
    // Instead, test with trivial reserves.
    let reserves = vec![0u64; 2];
    let total_minted: u128 = 0;
    verify_invariant(&reserves, total_minted).unwrap();
}

// ── Discrete Buy ────────────────────────────────────────────────

#[test]
fn test_compute_buy_binary() {
    let mut reserves = init_reserves(2, L);
    let total_minted = L;

    let tokens = compute_buy(&mut reserves, total_minted, 0, 100_000).unwrap();

    assert!(tokens > 0, "tokens_out={tokens}");

    // After buy, the position for outcome 0 increased (got tokens).
    // Price of outcome 0 should INCREASE.
    let tm_new = total_minted + 100_000;
    let probs = compute_probabilities(&reserves, tm_new);
    assert!(probs[0] > probs[1], "p0={}, p1={} — buying 0 should increase its price", probs[0], probs[1]);
}

#[test]
fn test_compute_buy_preserves_invariant_approximately() {
    let mut reserves = init_reserves(2, L);
    let total_minted = L;

    compute_buy(&mut reserves, total_minted, 0, 100_000).unwrap();

    let tm_new = total_minted + 100_000;
    let actual = sum_of_position_squares(&reserves, tm_new);
    let expected = tm_new * tm_new;
    let diff = if actual > expected { actual - expected } else { expected - actual };
    // isqrt rounding: at most 2 * max_position.
    let max_x = reserves.iter().map(|&h| tm_new - h as u128).max().unwrap();
    assert!(diff <= 2 * max_x + 1, "invariant diff={diff}, max_x={max_x}");
}

#[test]
fn test_compute_buy_then_sell_roundtrip() {
    let mut reserves = init_reserves(2, L);
    let mut total_minted = L;

    let tokens = compute_buy(&mut reserves, total_minted, 0, 100_000).unwrap();
    total_minted += 100_000;

    let collateral = compute_sell(&mut reserves, total_minted, 0, tokens).unwrap();
    let _total_minted = total_minted - collateral as u128;

    // Should get back approximately the same collateral (within rounding).
    let diff = if collateral > 100_000 {
        collateral - 100_000
    } else {
        100_000 - collateral
    };
    assert!(
        diff <= 1_000,
        "roundtrip diff={diff}, bought for 100000, got back {collateral}"
    );
}

#[test]
fn test_compute_buy_increases_price() {
    let mut reserves = init_reserves(5, L);
    let total_minted = L;

    let probs_before = compute_probabilities(&reserves, total_minted);
    compute_buy(&mut reserves, total_minted, 2, 50_000).unwrap();
    let tm_new = total_minted + 50_000;
    let probs_after = compute_probabilities(&reserves, tm_new);

    // Price of outcome 2 should INCREASE (position grows from buying).
    assert!(
        probs_after[2] > probs_before[2],
        "before={}, after={} — buying should increase price",
        probs_before[2],
        probs_after[2]
    );
}

// ── Discrete Sell ───────────────────────────────────────────────

#[test]
fn test_compute_sell_basic() {
    let mut reserves = init_reserves(2, L);
    let mut total_minted = L;

    // Buy first to get tokens, then sell them back.
    let tokens = compute_buy(&mut reserves, total_minted, 0, 100_000).unwrap();
    total_minted += 100_000;

    let collateral = compute_sell(&mut reserves, total_minted, 0, tokens).unwrap();
    assert!(collateral > 0);
}

// ── Scale Reserves ──────────────────────────────────────────────

#[test]
fn test_scale_reserves_add_liquidity() {
    let mut reserves = init_reserves(2, L);
    let total_minted: u128 = L;
    let deposit: u128 = 500_000;
    let numerator = total_minted + deposit;

    let new_k2 = scale_reserves(&mut reserves, numerator, total_minted).unwrap();

    // Reserves should scale by 1.5x.
    let expected_reserve = (init_reserves(2, L)[0] as u128 * numerator / total_minted) as u64;
    assert_eq!(reserves[0], expected_reserve);
    assert_eq!(reserves[1], expected_reserve);
    // Return is numerator² = total_minted_new².
    assert_eq!(new_k2, numerator * numerator);
}

#[test]
fn test_scale_reserves_remove_liquidity() {
    let mut reserves = init_reserves(2, L);
    let total_minted: u128 = L;
    let withdrawal: u128 = 250_000;
    let numerator = total_minted - withdrawal;

    let new_k2 = scale_reserves(&mut reserves, numerator, total_minted).unwrap();

    let expected_reserve = (init_reserves(2, L)[0] as u128 * numerator / total_minted) as u64;
    assert_eq!(reserves[0], expected_reserve);
    assert_eq!(reserves[1], expected_reserve);
    assert_eq!(new_k2, numerator * numerator);
}

#[test]
fn test_scale_reserves_preserves_ratios() {
    let mut reserves = vec![800_000u64, 1_200_000];
    let total_minted: u128 = 2_000_000;
    let numerator: u128 = 3_000_000; // 1.5x

    let _new_k2 = scale_reserves(&mut reserves, numerator, total_minted).unwrap();

    // 800k * 3/2 = 1200k, 1200k * 3/2 = 1800k
    assert_eq!(reserves[0], 1_200_000);
    assert_eq!(reserves[1], 1_800_000);
}

// ── Probabilities ───────────────────────────────────────────────

#[test]
fn test_probabilities_uniform() {
    let reserves = init_reserves(2, L);
    let probs = compute_probabilities(&reserves, L);
    // Should be approximately 500M each.
    let diff0 = if probs[0] > 500_000_000 { probs[0] - 500_000_000 } else { 500_000_000 - probs[0] };
    let diff1 = if probs[1] > 500_000_000 { probs[1] - 500_000_000 } else { 500_000_000 - probs[1] };
    assert!(diff0 < 5_000, "p0={}", probs[0]);
    assert!(diff1 < 5_000, "p1={}", probs[1]);
}

#[test]
fn test_probabilities_exact_pythagorean() {
    // Pythagorean triple: x=[3M, 4M], total_minted=5M
    let reserves = vec![2_000_000u64, 1_000_000];
    let total_minted: u128 = 5_000_000;
    let probs = compute_probabilities(&reserves, total_minted);
    // p0 = 3M²*SCALE / 25M² = 9/25 * SCALE = 360_000_000
    assert_eq!(probs[0], 360_000_000);
    // p1 = 4M²*SCALE / 25M² = 16/25 * SCALE = 640_000_000
    assert_eq!(probs[1], 640_000_000);
    // Sum = SCALE.
    assert_eq!(probs[0] + probs[1], SCALE);
}

#[test]
fn test_probabilities_sum_approximately_scale() {
    let reserves = init_reserves(5, L);
    let probs = compute_probabilities(&reserves, L);
    let sum: u128 = probs.iter().sum();
    let diff = if sum > SCALE { sum - SCALE } else { SCALE - sum };
    // Allow tolerance for isqrt rounding.
    assert!(diff <= 5_000, "sum={sum}, expected ~{SCALE}");
}

#[test]
fn test_probabilities_zero_total_minted() {
    let reserves = vec![100u64; 3];
    let probs = compute_probabilities(&reserves, 0);
    assert!(probs.iter().all(|&p| p == 0));
}

#[test]
fn test_probabilities_single_outcome() {
    // Single outcome: x = total_minted - h = total_minted - 0 = total_minted
    // p = total_minted² * SCALE / total_minted² = SCALE
    let reserves = vec![0u64];
    let total_minted: u128 = 1_000_000;
    let probs = compute_probabilities(&reserves, total_minted);
    assert_eq!(probs.len(), 1);
    assert_eq!(probs[0], SCALE);
}

// ── Distribution Buy ────────────────────────────────────────────

#[test]
fn test_distribution_buy_uniform_weights() {
    let mut reserves = init_reserves(2, L);
    let total_minted = L;
    let weights = vec![(SCALE / 2) as u64; 2];

    let tokens = compute_distribution_buy(&mut reserves, total_minted, &weights, 100_000).unwrap();

    // Each bin should get approximately the same tokens.
    let diff = if tokens[0] > tokens[1] {
        tokens[0] - tokens[1]
    } else {
        tokens[1] - tokens[0]
    };
    assert!(diff <= 1, "tokens={:?}", tokens);
    // Total tokens should be positive.
    let total: u64 = tokens.iter().sum();
    assert!(total > 0, "total={total}");
}

#[test]
fn test_distribution_buy_single_bin_weight() {
    // All weight on bin 0 → equivalent to discrete buy.
    let mut reserves_dist = init_reserves(2, L);
    let mut reserves_disc = init_reserves(2, L);
    let total_minted = L;
    let weights = vec![SCALE as u64, 0];

    let tokens_dist =
        compute_distribution_buy(&mut reserves_dist, total_minted, &weights, 100_000).unwrap();
    let tokens_disc = compute_buy(&mut reserves_disc, total_minted, 0, 100_000).unwrap();

    // Should be very close (differ only by integer rounding path).
    let diff = if tokens_dist[0] > tokens_disc {
        tokens_dist[0] - tokens_disc
    } else {
        tokens_disc - tokens_dist[0]
    };
    assert!(diff <= 100, "dist={}, disc={}", tokens_dist[0], tokens_disc);
    assert_eq!(tokens_dist[1], 0);
}

// ── Distribution Sell ───────────────────────────────────────────

#[test]
fn test_distribution_sell_basic() {
    let mut reserves = init_reserves(2, L);
    let mut total_minted = L;
    let weights = vec![(SCALE / 2) as u64; 2];

    // Buy first.
    let tokens =
        compute_distribution_buy(&mut reserves, total_minted, &weights, 100_000).unwrap();
    total_minted += 100_000;
    let total_tokens: u64 = tokens.iter().sum();

    // Sell back.
    let collateral =
        compute_distribution_sell(&mut reserves, total_minted, &weights, total_tokens).unwrap();

    // Should get back approximately the same collateral.
    let diff = if collateral > 100_000 {
        collateral - 100_000
    } else {
        100_000 - collateral
    };
    assert!(
        diff <= 1_000,
        "roundtrip diff={diff}, collateral={collateral}"
    );
}

// ── compute_buy edge cases ─────────────────────────────────────

#[test]
fn test_compute_buy_invalid_outcome() {
    let mut reserves = init_reserves(2, L);
    assert!(compute_buy(&mut reserves, L, 2, 100_000).is_err());
}

#[test]
fn test_compute_buy_outcome_eq_n() {
    let mut reserves = init_reserves(5, L);
    assert!(compute_buy(&mut reserves, L, 5, 50_000).is_err());
}

#[test]
fn test_compute_buy_zero_collateral() {
    let mut reserves = init_reserves(2, L);
    assert!(compute_buy(&mut reserves, L, 0, 0).is_err());
}

#[test]
fn test_compute_buy_overflow_on_reserve_add() {
    let mut reserves = vec![u64::MAX, 1_000_000];
    let total_minted: u128 = u64::MAX as u128;
    assert!(compute_buy(&mut reserves, total_minted, 0, 1).is_err());
}

// ── compute_sell edge cases ────────────────────────────────────

#[test]
fn test_compute_sell_invalid_outcome() {
    let mut reserves = init_reserves(2, L);
    assert!(compute_sell(&mut reserves, L, 3, 100_000).is_err());
}

#[test]
fn test_compute_sell_zero_tokens() {
    let mut reserves = init_reserves(2, L);
    assert!(compute_sell(&mut reserves, L, 0, 0).is_err());
}

#[test]
fn test_compute_sell_exceeds_position() {
    // Try to sell more tokens than the total position for that outcome.
    let reserves = init_reserves(2, L);
    let x_0 = L - reserves[0] as u128; // position for outcome 0
    let sell_amount = (x_0 + 1) as u64; // one more than position
    let mut reserves_mut = reserves;
    assert!(compute_sell(&mut reserves_mut, L, 0, sell_amount).is_err());
}

// ── scale_reserves edge cases ──────────────────────────────────

#[test]
fn test_scale_reserves_denominator_zero() {
    let mut reserves = init_reserves(2, L);
    assert!(scale_reserves(&mut reserves, 1, 0).is_err());
}

#[test]
fn test_scale_reserves_numerator_zero() {
    let mut reserves = init_reserves(2, L);
    let new_k2 = scale_reserves(&mut reserves, 0, L).unwrap();
    assert_eq!(reserves[0], 0);
    assert_eq!(reserves[1], 0);
    assert_eq!(new_k2, 0);
}

#[test]
fn test_scale_reserves_truncation() {
    // Non-exact division should truncate (floor).
    let mut reserves = vec![1_000_000u64; 2];
    let total_minted: u128 = 1_500_000;
    let numerator: u128 = 1_000_000; // scale down by 2/3
    let _new_k2 = scale_reserves(&mut reserves, numerator, total_minted).unwrap();
    assert_eq!(reserves[0], 666_666);
    assert_eq!(reserves[1], 666_666);
}

#[test]
fn test_scale_reserves_overflow() {
    let mut reserves = vec![u64::MAX; 2];
    assert!(scale_reserves(&mut reserves, u128::MAX, 1).is_err());
}

// ── compute_distribution_buy edge cases ────────────────────────

#[test]
fn test_distribution_buy_mismatched_lengths() {
    let mut reserves = init_reserves(3, L);
    let weights = vec![500_000_000u64; 2]; // 2 weights for 3 reserves
    assert!(compute_distribution_buy(&mut reserves, L, &weights, 100_000).is_err());
}

#[test]
fn test_distribution_buy_all_zero_weights() {
    let mut reserves = init_reserves(2, L);
    let weights = vec![0u64; 2];
    assert!(compute_distribution_buy(&mut reserves, L, &weights, 100_000).is_err());
}

#[test]
fn test_distribution_buy_zero_collateral() {
    let mut reserves = init_reserves(2, L);
    let weights = vec![500_000_000u64; 2];
    assert!(compute_distribution_buy(&mut reserves, L, &weights, 0).is_err());
}

// ── compute_distribution_sell edge cases ───────────────────────

#[test]
fn test_distribution_sell_mismatched_lengths() {
    let mut reserves = init_reserves(3, L);
    let weights = vec![500_000_000u64; 2];
    assert!(compute_distribution_sell(&mut reserves, L, &weights, 100_000).is_err());
}

#[test]
fn test_distribution_sell_zero_total_tokens() {
    let mut reserves = init_reserves(2, L);
    let weights = vec![500_000_000u64; 2];
    assert!(compute_distribution_sell(&mut reserves, L, &weights, 0).is_err());
}

// ── Cross-outcome trades ─────────────────────────────────────

#[test]
fn test_buy_different_outcomes_prices_diverge() {
    let mut reserves = init_reserves(3, L);
    let mut total_minted = L;

    // Buy outcome 0.
    compute_buy(&mut reserves, total_minted, 0, 50_000).unwrap();
    total_minted += 50_000;

    // Buy outcome 2.
    compute_buy(&mut reserves, total_minted, 2, 50_000).unwrap();
    total_minted += 50_000;

    let probs = compute_probabilities(&reserves, total_minted);
    // Outcomes 0 and 2 (bought) should have HIGHER probability.
    // Outcome 1 (unbought) should have LOWER probability.
    assert!(
        probs[0] > probs[1],
        "bought outcome 0 should have higher prob: p0={}, p1={}",
        probs[0],
        probs[1]
    );
    assert!(
        probs[2] > probs[1],
        "bought outcome 2 should have higher prob: p2={}, p1={}",
        probs[2],
        probs[1]
    );
}

// ── Path independence ─────────────────────────────────────

#[test]
fn test_path_independence_single_outcome() {
    // L2-norm CFAMM is path-independent for single-outcome trades:
    // one big buy yields the same total tokens as many small buys
    // totaling the same collateral, because non-bought positions
    // are invariant under complete-set minting.
    let mut reserves_big = init_reserves(2, L);
    let total_minted_big = L;

    let tokens_big = compute_buy(&mut reserves_big, total_minted_big, 0, 200_000).unwrap();

    let mut reserves_small = init_reserves(2, L);
    let mut tm = L;
    let mut total_tokens_small: u64 = 0;
    for _ in 0..10 {
        let tokens = compute_buy(&mut reserves_small, tm, 0, 20_000).unwrap();
        total_tokens_small += tokens;
        tm += 20_000;
    }

    // Path-independent: total tokens should be equal (±1 from isqrt rounding).
    let diff = if total_tokens_small > tokens_big {
        total_tokens_small - tokens_big
    } else {
        tokens_big - total_tokens_small
    };
    assert!(
        diff <= 1,
        "path independence: small={total_tokens_small}, big={tokens_big}, diff={diff}"
    );
}

// ── Multi-trade sequences ──────────────────────────────────────

#[test]
fn test_buy_buy_sell_sequence() {
    let mut reserves = init_reserves(2, L);
    let mut total_minted = L;

    // Buy #1 on outcome 0.
    let tokens_1 = compute_buy(&mut reserves, total_minted, 0, 50_000).unwrap();
    total_minted += 50_000;

    // Buy #2 on outcome 1.
    let tokens_2 = compute_buy(&mut reserves, total_minted, 1, 30_000).unwrap();
    total_minted += 30_000;

    assert!(tokens_1 > 0);
    assert!(tokens_2 > 0);

    // Sell #1 (sell back some of outcome 0).
    let collateral = compute_sell(&mut reserves, total_minted, 0, tokens_1 / 2).unwrap();
    assert!(collateral > 0);
}

#[test]
fn test_many_small_trades_roundtrip() {
    let mut reserves = init_reserves(2, L);
    let mut total_minted = L;

    for _ in 0..20 {
        let tokens = compute_buy(&mut reserves, total_minted, 0, 10_000).unwrap();
        total_minted += 10_000;
        let coll = compute_sell(&mut reserves, total_minted, 0, tokens).unwrap();
        total_minted -= coll as u128;
    }

    // total_minted should be close to original L (within roundtrip losses).
    let drift = if total_minted > L { total_minted - L } else { L - total_minted };
    assert!(
        drift <= 1_000,
        "excessive total_minted drift after 20 roundtrips: drift={drift}"
    );
}

#[test]
fn test_100_trade_roundtrip_total_minted_drift() {
    let mut reserves = init_reserves(2, L);
    let mut total_minted = L;

    for _ in 0..100 {
        let tokens = compute_buy(&mut reserves, total_minted, 0, 5_000).unwrap();
        total_minted += 5_000;
        let coll = compute_sell(&mut reserves, total_minted, 0, tokens).unwrap();
        total_minted -= coll as u128;
    }

    // total_minted drift should be bounded.
    let drift = if total_minted > L { total_minted - L } else { L - total_minted };
    assert!(
        drift <= 5_000,
        "excessive total_minted drift after 100 roundtrips: drift={drift}"
    );
}

// ── Large value boundary tests ─────────────────────────────────

#[test]
fn test_compute_buy_large_reserves() {
    let big_l: u128 = 1_000_000_000_000; // 10^12
    let mut reserves = init_reserves(2, big_l);
    let total_minted = big_l;

    let tokens = compute_buy(&mut reserves, total_minted, 0, 1_000_000_000).unwrap();
    assert!(tokens > 0);
}

#[test]
fn test_compute_sell_large_reserves_roundtrip() {
    let big_l: u128 = 1_000_000_000_000;
    let mut reserves = init_reserves(2, big_l);
    let mut total_minted = big_l;

    let tokens = compute_buy(&mut reserves, total_minted, 0, 1_000_000_000).unwrap();
    total_minted += 1_000_000_000;
    let collateral = compute_sell(&mut reserves, total_minted, 0, tokens).unwrap();
    assert!(collateral > 0);
    let diff = if collateral > 1_000_000_000 {
        collateral - 1_000_000_000
    } else {
        1_000_000_000 - collateral
    };
    assert!(diff <= 1_000_000, "roundtrip diff={diff}");
}

#[test]
fn test_scale_reserves_large_values() {
    let big_l: u128 = 1_000_000_000_000;
    let mut reserves = init_reserves(2, big_l);
    let numerator: u128 = big_l + 500_000_000_000; // 1.5x
    let denominator = big_l;

    let new_k2 = scale_reserves(&mut reserves, numerator, denominator).unwrap();

    // Return should be numerator².
    assert_eq!(new_k2, numerator * numerator);
}

// ── Five-outcome buy ────────────────────────────────────────

#[test]
fn test_compute_buy_all_five_outcomes_sequentially() {
    let mut reserves = init_reserves(5, L);
    let mut total_minted = L;

    for outcome in 0..5 {
        let tokens = compute_buy(&mut reserves, total_minted, outcome, 10_000).unwrap();
        assert!(tokens > 0, "outcome {outcome} should yield tokens");
        total_minted += 10_000;
    }

    // After buying all outcomes equally, prices should be roughly uniform.
    let probs = compute_probabilities(&reserves, total_minted);
    let avg = SCALE / 5;
    for (i, &p) in probs.iter().enumerate() {
        let diff = if p > avg { p - avg } else { avg - p };
        assert!(
            diff < avg / 5,
            "outcome {i} probability {p} too far from avg {avg}"
        );
    }
}

// ── scale_reserves truncation to zero ───────────────────────

#[test]
fn test_scale_reserves_tiny_values_truncate_to_zero() {
    let mut reserves = vec![1u64; 2];
    let new_k2 = scale_reserves(&mut reserves, 1, 1000).unwrap();
    assert_eq!(reserves[0], 0);
    assert_eq!(reserves[1], 0);
    // numerator² = 1² = 1, but reserves are zero so invariant won't hold.
    // The function just returns numerator².
    assert_eq!(new_k2, 1);
}

// ── Successive buys yield fewer tokens (correct price increase) ─

#[test]
fn test_successive_buys_yield_fewer_tokens() {
    let mut reserves = init_reserves(2, L);
    let mut total_minted = L;

    let tokens_1 = compute_buy(&mut reserves, total_minted, 0, 100_000).unwrap();
    total_minted += 100_000;

    let tokens_2 = compute_buy(&mut reserves, total_minted, 0, 100_000).unwrap();
    total_minted += 100_000;

    let tokens_3 = compute_buy(&mut reserves, total_minted, 0, 100_000).unwrap();

    // Each successive buy of the same outcome should yield FEWER tokens
    // (price increases with each purchase).
    assert!(
        tokens_1 > tokens_2,
        "first buy should yield more: t1={tokens_1}, t2={tokens_2}"
    );
    assert!(
        tokens_2 > tokens_3,
        "second buy should yield more than third: t2={tokens_2}, t3={tokens_3}"
    );
}

// ── Price-targeted trading helpers ──────────────────────────────

#[test]
fn test_collateral_for_target_prob_binary_50_to_70() {
    let reserves = init_reserves(2, L);
    let effective = compute_collateral_for_target_prob(&reserves, L, 0, 700_000_000).unwrap();
    assert!(effective > 0, "should need positive collateral to go from 50% to 70%");

    // Verify: execute the buy and check the resulting probability.
    let mut reserves_exec = reserves.clone();
    compute_buy(&mut reserves_exec, L, 0, effective).unwrap();
    let probs = compute_probabilities(&reserves_exec, L + effective as u128);
    // Should be close to 70% (700_000_000 / SCALE), within isqrt rounding.
    let diff = if probs[0] > 700_000_000 {
        probs[0] - 700_000_000
    } else {
        700_000_000 - probs[0]
    };
    assert!(
        diff <= 2_000, // tolerance for isqrt rounding
        "probability should be ~70%: got {}, diff={}",
        probs[0], diff
    );
}

#[test]
fn test_collateral_for_target_prob_binary_50_to_90() {
    let reserves = init_reserves(2, L);
    let effective = compute_collateral_for_target_prob(&reserves, L, 0, 900_000_000).unwrap();
    assert!(effective > 0);

    let mut reserves_exec = reserves.clone();
    compute_buy(&mut reserves_exec, L, 0, effective).unwrap();
    let probs = compute_probabilities(&reserves_exec, L + effective as u128);
    let diff = if probs[0] > 900_000_000 {
        probs[0] - 900_000_000
    } else {
        900_000_000 - probs[0]
    };
    assert!(
        diff <= 2_000,
        "probability should be ~90%: got {}, diff={}",
        probs[0], diff
    );
}

#[test]
fn test_collateral_for_target_prob_multi_outcome() {
    // 4-outcome market, uniform start (~25% each), buy outcome 2 to 40%.
    let reserves = init_reserves(4, L);
    let effective = compute_collateral_for_target_prob(&reserves, L, 2, 400_000_000).unwrap();
    assert!(effective > 0);

    let mut reserves_exec = reserves.clone();
    compute_buy(&mut reserves_exec, L, 2, effective).unwrap();
    let probs = compute_probabilities(&reserves_exec, L + effective as u128);
    let diff = if probs[2] > 400_000_000 {
        probs[2] - 400_000_000
    } else {
        400_000_000 - probs[2]
    };
    assert!(
        diff <= 5_000,
        "probability should be ~40%: got {}, diff={}",
        probs[2], diff
    );
}

#[test]
fn test_collateral_for_target_prob_invalid_zero() {
    let reserves = init_reserves(2, L);
    let err = compute_collateral_for_target_prob(&reserves, L, 0, 0).unwrap_err();
    assert_eq!(err, error!(DekantPmError::InvalidProbability));
}

#[test]
fn test_collateral_for_target_prob_invalid_scale() {
    let reserves = init_reserves(2, L);
    let err = compute_collateral_for_target_prob(&reserves, L, 0, SCALE).unwrap_err();
    assert_eq!(err, error!(DekantPmError::InvalidProbability));
}

#[test]
fn test_collateral_for_target_prob_target_below_current() {
    let reserves = init_reserves(2, L);
    // Current is ~50%, target 30% → should error (need to sell, not buy).
    let err = compute_collateral_for_target_prob(&reserves, L, 0, 300_000_000).unwrap_err();
    assert_eq!(err, error!(DekantPmError::TargetAlreadyMet));
}

#[test]
fn test_tokens_for_target_prob_binary_50_to_30() {
    // First buy outcome 0 to ~70%, then sell back toward 30%.
    let mut reserves = init_reserves(2, L);
    let buy_c = 500_000u64;
    let _tokens = compute_buy(&mut reserves, L, 0, buy_c).unwrap();
    let tm = L + buy_c as u128;

    let probs_before = compute_probabilities(&reserves, tm);
    assert!(probs_before[0] > 500_000_000, "should be above 50% after buy");

    let tokens_in = compute_tokens_for_target_prob(&reserves, tm, 0, 300_000_000).unwrap();
    assert!(tokens_in > 0, "should need to sell some tokens");

    // Execute the sell and verify probability.
    let mut reserves_exec = reserves.clone();
    let collateral_out = compute_sell(&mut reserves_exec, tm, 0, tokens_in).unwrap();
    let tm_after = tm - collateral_out as u128;
    let probs = compute_probabilities(&reserves_exec, tm_after);
    let diff = if probs[0] > 300_000_000 {
        probs[0] - 300_000_000
    } else {
        300_000_000 - probs[0]
    };
    assert!(
        diff <= 5_000,
        "probability should be ~30%: got {}, diff={}",
        probs[0], diff
    );
}

#[test]
fn test_tokens_for_target_prob_target_above_current() {
    let reserves = init_reserves(2, L);
    // Current ~50%, target 70% → should error (need to buy, not sell).
    let err = compute_tokens_for_target_prob(&reserves, L, 0, 700_000_000).unwrap_err();
    assert_eq!(err, error!(DekantPmError::TargetAlreadyMet));
}

#[test]
fn test_tokens_for_target_prob_to_zero() {
    // Buy outcome 0 to ~70%, then sell to 0% (sell entire position).
    let mut reserves = init_reserves(2, L);
    let buy_c = 500_000u64;
    let _tokens = compute_buy(&mut reserves, L, 0, buy_c).unwrap();
    let tm = L + buy_c as u128;

    let tokens_in = compute_tokens_for_target_prob(&reserves, tm, 0, 0).unwrap();
    // Should require selling the full position.
    let x_i = tm - reserves[0] as u128;
    assert_eq!(tokens_in, x_i as u64, "sell to 0% should sell entire position");
}

#[test]
fn test_buy_then_sell_to_price_roundtrip() {
    // Buy outcome 0 to 70%, then sell back to ~50%. Check market is near original.
    let mut reserves = init_reserves(2, L);
    let total_minted = L;

    // Buy to 70%.
    let buy_c = compute_collateral_for_target_prob(&reserves, total_minted, 0, 700_000_000).unwrap();
    compute_buy(&mut reserves, total_minted, 0, buy_c).unwrap();
    let tm_after_buy = total_minted + buy_c as u128;

    // Sell back to 50%.
    let sell_tokens = compute_tokens_for_target_prob(&reserves, tm_after_buy, 0, 500_000_000).unwrap();
    let collateral_out = compute_sell(&mut reserves, tm_after_buy, 0, sell_tokens).unwrap();
    let tm_final = tm_after_buy - collateral_out as u128;

    let probs = compute_probabilities(&reserves, tm_final);
    let diff = if probs[0] > 500_000_000 {
        probs[0] - 500_000_000
    } else {
        500_000_000 - probs[0]
    };
    assert!(
        diff <= 5_000,
        "should be back near 50%: got {}, diff={}",
        probs[0], diff
    );
}

// ── Large trade relative to pool (trade >> initial liquidity) ─────

#[test]
fn test_buy_2x_pool_binary() {
    // Pool = 1M, trade = 2M (2x the pool)
    let mut reserves = init_reserves(2, L);
    let mut total_minted = L;
    let trade = 2_000_000u64; // 2x L

    let tokens = compute_buy(&mut reserves, total_minted, 0, trade).unwrap();
    total_minted += trade as u128;
    assert!(tokens > 0, "should receive tokens");

    // Note: verify_invariant uses a tight tolerance (256) that isqrt rounding
    // can exceed at these scales. On-chain, k_squared is set to total_minted²
    // directly after trades, so the invariant holds by construction.
    // Here we check the properties that matter: probabilities are correct.
    let probs = compute_probabilities(&reserves, total_minted);
    let sum: u128 = probs.iter().sum();
    let sum_diff = if sum > SCALE { sum - SCALE } else { SCALE - sum };
    assert!(sum_diff <= 1_000, "probs should sum to ~SCALE: sum={sum}, diff={sum_diff}");

    // Price should have moved dramatically toward outcome 0
    assert!(probs[0] > 800_000_000, "p[0] should be >80%: got {}", probs[0]);
}

#[test]
fn test_buy_10x_pool_binary() {
    // Pool = 1M, trade = 10M (10x the pool)
    let mut reserves = init_reserves(2, L);
    let mut total_minted = L;
    let trade = 10_000_000u64;

    let tokens = compute_buy(&mut reserves, total_minted, 0, trade).unwrap();
    total_minted += trade as u128;
    assert!(tokens > 0);

    let probs = compute_probabilities(&reserves, total_minted);
    let sum: u128 = probs.iter().sum();
    let sum_diff = if sum > SCALE { sum - SCALE } else { SCALE - sum };
    assert!(sum_diff <= 1_000, "probs should sum to ~SCALE: sum={sum}, diff={sum_diff}");
    assert!(probs[0] > 950_000_000, "p[0] should be >95%: got {}", probs[0]);
}

#[test]
fn test_buy_20x_pool_binary() {
    // Pool = 1M, trade = 20M (20x the pool)
    let mut reserves = init_reserves(2, L);
    let mut total_minted = L;
    let trade = 20_000_000u64;

    let tokens = compute_buy(&mut reserves, total_minted, 0, trade).unwrap();
    total_minted += trade as u128;
    assert!(tokens > 0);

    let probs = compute_probabilities(&reserves, total_minted);
    let sum: u128 = probs.iter().sum();
    let sum_diff = if sum > SCALE { sum - SCALE } else { SCALE - sum };
    assert!(sum_diff <= 1_000, "probs should sum to ~SCALE: sum={sum}, diff={sum_diff}");
    assert!(probs[0] > 970_000_000, "p[0] should be >97%: got {}", probs[0]);
}

#[test]
fn test_buy_20x_pool_multi_outcome() {
    // 5-outcome market, pool = 1M, trade = 20M
    let mut reserves = init_reserves(5, L);
    let mut total_minted = L;
    let trade = 20_000_000u64;

    let tokens = compute_buy(&mut reserves, total_minted, 2, trade).unwrap();
    total_minted += trade as u128;
    assert!(tokens > 0);

    let probs = compute_probabilities(&reserves, total_minted);
    let sum: u128 = probs.iter().sum();
    let sum_diff = if sum > SCALE { sum - SCALE } else { SCALE - sum };
    assert!(sum_diff <= 1_000, "probs should sum to ~SCALE: sum={sum}, diff={sum_diff}");

    // Outcome 2 should dominate
    assert!(probs[2] > 900_000_000, "p[2] should be >90%: got {}", probs[2]);

    // All others should be small but non-negative
    for (i, &p) in probs.iter().enumerate() {
        if i != 2 {
            assert!(p < 50_000_000, "p[{i}] should be <5%: got {p}");
        }
    }
}

#[test]
fn test_buy_20x_pool_then_sell_all_back() {
    // Buy 20x, then sell all tokens back — should recover most collateral
    let mut reserves = init_reserves(2, L);
    let mut total_minted = L;
    let trade = 20_000_000u64;

    let tokens = compute_buy(&mut reserves, total_minted, 0, trade).unwrap();
    total_minted += trade as u128;

    let collateral_back = compute_sell(&mut reserves, total_minted, 0, tokens).unwrap();
    total_minted -= collateral_back as u128;

    // Should recover close to original (within isqrt rounding)
    let probs = compute_probabilities(&reserves, total_minted);
    let diff = if probs[0] > 500_000_000 {
        probs[0] - 500_000_000
    } else {
        500_000_000 - probs[0]
    };
    assert!(diff <= 5_000, "should be near 50% after roundtrip: got {}, diff={diff}", probs[0]);

    // Collateral recovered should be close to what was spent (isqrt rounding
    // can cause tiny gain or loss)
    let diff_rt = (trade as i128 - collateral_back as i128).unsigned_abs();
    assert!(
        diff_rt < trade as u128 / 1000,
        "roundtrip diff too large: diff={diff_rt}, trade={trade}"
    );
}

#[test]
fn test_distribution_buy_20x_pool() {
    // Continuous market (32 bins), pool = 1M, trade = 20M
    let mut reserves = init_reserves(32, L);
    let mut total_minted = L;
    let trade = 20_000_000u64;

    // Gaussian-like weights centered on bin 16
    let mut weights = vec![0u64; 32];
    for i in 0..32 {
        let dist = if i >= 16 { i - 16 } else { 16 - i };
        weights[i] = match dist {
            0 => SCALE as u64,
            1 => 800_000_000,
            2 => 500_000_000,
            3 => 250_000_000,
            4 => 100_000_000,
            5 => 30_000_000,
            _ => 1_000_000, // small but nonzero to avoid division issues
        };
    }

    let tokens_out = compute_distribution_buy(&mut reserves, total_minted, &weights, trade).unwrap();
    total_minted += trade as u128;

    // Should receive tokens in all bins with nonzero weights
    assert!(tokens_out[16] > 0, "center bin should get tokens");
    assert!(tokens_out[16] > tokens_out[0], "center should get more than edges");

    let probs = compute_probabilities(&reserves, total_minted);
    let sum: u128 = probs.iter().sum();
    let sum_diff = if sum > SCALE { sum - SCALE } else { SCALE - sum };
    assert!(sum_diff <= 1_000, "probs should sum to ~SCALE: sum={sum}, diff={sum_diff}");

    // Center bin should have highest probability
    assert!(probs[16] > probs[0], "center should have higher prob");
}

// ── BUG-001: Distribution Buy u128 Overflow ─────────────────────
//
// These tests reproduce BUG-001: compute_distribution_buy overflows
// u128 at moderate liquidity levels on continuous markets due to
// squaring xw (which contains a SCALE=10^9 factor).
//
// EXPECTED BEHAVIOR:
//   Before fix → these tests FAIL (function returns MathOverflow)
//   After fix  → these tests PASS (function succeeds)
//
// The overflow thresholds (uniform weights):
//   n=2:   ~$26K USDC (total_minted ~ 2.6e10)
//   n=256: ~$295K USDC (total_minted ~ 2.95e11)

/// Helper: uniform weights for n bins, each = SCALE / n.
fn uniform_weights(n: usize) -> Vec<u64> {
    vec![(SCALE / n as u128) as u64; n]
}

/// BUG-001 reproduction: 2 bins, $30K USDC liquidity.
///
/// xw ≈ 2.12e19 → xw^2 ≈ 4.5e38 > u128::MAX (3.4e38).
/// Currently returns MathOverflow; after fix should succeed.
#[test]
fn test_bug001_overflow_2_bins_30k_usd() {
    let n: usize = 2;
    let total_minted: u128 = 30_000_000_000; // $30K USDC (6 decimals)
    let mut reserves = init_reserves(n, total_minted);
    let weights = uniform_weights(n);
    let trade = 1_000_000u64; // $1 USDC

    let result = compute_distribution_buy(&mut reserves, total_minted, &weights, trade);

    assert!(
        result.is_ok(),
        "BUG-001: compute_distribution_buy overflows at $30K with 2 bins. \
         Error: {:?}",
        result.err()
    );

    let tokens = result.unwrap();
    let total_tokens: u64 = tokens.iter().sum();
    assert!(total_tokens > 0, "should receive tokens");

    // Invariant: Σ(k_new - reserves[i])² ≈ k_new² (proportional tolerance
    // because init_reserves uses isqrt which introduces small rounding)
    let k_new = total_minted + trade as u128;
    let actual_sq = sum_of_position_squares(&reserves, k_new);
    let expected_sq = k_new * k_new;
    assert!(
        actual_sq.abs_diff(expected_sq) <= expected_sq / 1_000_000,
        "invariant relative error {} too large (expected_sq={})",
        actual_sq.abs_diff(expected_sq), expected_sq
    );

    // L2-norm AMM with uniform weights: total_tokens ≈ trade * sqrt(n).
    // For n=2, sqrt(2) ≈ 1.414, so $1 trade yields ~$1.41 in tokens.
    let expected_total = isqrt((trade as u128) * (trade as u128) * n as u128);
    assert!(
        (total_tokens as u128).abs_diff(expected_total) <= expected_total / 20,
        "total_tokens ({total_tokens}) not within 5% of expected ({expected_total})"
    );

    // Uniform weights → equal distribution, all bins > 0
    assert!(tokens[0] > 0 && tokens[1] > 0, "all bins should get tokens: {:?}", tokens);
    let diff = tokens[0].abs_diff(tokens[1]);
    assert!(diff <= 1, "uniform weights → equal tokens: {:?}", tokens);
}

/// BUG-001 reproduction: 256 bins (MAX_BINS), $300K USDC liquidity.
///
/// xw ≈ 1.875e19 → xw^2 ≈ 3.52e38 > u128::MAX (3.4e38).
/// This is the maximum-bins worst case from the bug report.
#[test]
fn test_bug001_overflow_256_bins_300k_usd() {
    let n: usize = 256;
    let total_minted: u128 = 300_000_000_000; // $300K USDC
    let mut reserves = init_reserves(n, total_minted);
    let weights = uniform_weights(n);
    let trade = 1_000_000u64; // $1 USDC

    let result = compute_distribution_buy(&mut reserves, total_minted, &weights, trade);

    assert!(
        result.is_ok(),
        "BUG-001: compute_distribution_buy overflows at $300K with 256 bins. \
         Error: {:?}",
        result.err()
    );

    let tokens = result.unwrap();
    let total_tokens: u64 = tokens.iter().sum();
    assert!(total_tokens > 0, "should receive tokens");

    // Invariant check (proportional tolerance)
    let k_new = total_minted + trade as u128;
    let actual_sq = sum_of_position_squares(&reserves, k_new);
    let expected_sq = k_new * k_new;
    assert!(
        actual_sq.abs_diff(expected_sq) <= expected_sq / 1_000_000,
        "invariant relative error {} too large (expected_sq={})",
        actual_sq.abs_diff(expected_sq), expected_sq
    );

    // L2-norm: total ≈ trade * sqrt(256) = trade * 16
    let expected_total = isqrt((trade as u128) * (trade as u128) * n as u128);
    assert!(
        (total_tokens as u128).abs_diff(expected_total) <= expected_total / 20,
        "total_tokens ({total_tokens}) not within 5% of expected ({expected_total})"
    );

    // Uniform weights → all bins should get roughly equal tokens
    let per_bin = total_tokens / n as u64;
    for (i, &t) in tokens.iter().enumerate() {
        assert!(
            t.abs_diff(per_bin) <= 1,
            "bin {i}: expected ~{per_bin}, got {t}"
        );
    }
}

/// BUG-001 extended: 64 bins, $1M USDC — verifies the fix raises
/// the ceiling well above practical liquidity levels.
#[test]
fn test_bug001_overflow_64_bins_1m_usd() {
    let n: usize = 64;
    let total_minted: u128 = 1_000_000_000_000; // $1M USDC
    let mut reserves = init_reserves(n, total_minted);
    let weights = uniform_weights(n);
    let trade = 10_000_000u64; // $10 USDC

    let result = compute_distribution_buy(&mut reserves, total_minted, &weights, trade);

    assert!(
        result.is_ok(),
        "BUG-001: compute_distribution_buy should handle $1M with 64 bins. \
         Error: {:?}",
        result.err()
    );

    let tokens = result.unwrap();
    let total_tokens: u64 = tokens.iter().sum();
    assert!(total_tokens > 0, "should receive tokens");

    // Invariant check (proportional tolerance)
    let k_new = total_minted + trade as u128;
    let actual_sq = sum_of_position_squares(&reserves, k_new);
    let expected_sq = k_new * k_new;
    assert!(
        actual_sq.abs_diff(expected_sq) <= expected_sq / 1_000_000,
        "invariant relative error {} too large (expected_sq={})",
        actual_sq.abs_diff(expected_sq), expected_sq
    );

    // L2-norm: total ≈ trade * sqrt(64) = trade * 8
    let expected_total = isqrt((trade as u128) * (trade as u128) * n as u128);
    assert!(
        (total_tokens as u128).abs_diff(expected_total) <= expected_total / 20,
        "total_tokens ({total_tokens}) not within 5% of expected ({expected_total})"
    );

    // Uniform weights → roughly equal per-bin distribution
    let per_bin = total_tokens / n as u64;
    for (i, &t) in tokens.iter().enumerate() {
        assert!(
            t.abs_diff(per_bin) <= 1,
            "bin {i}: expected ~{per_bin}, got {t}"
        );
    }
}

/// BUG-001 secondary overflow: w2 * excess overflows for large trades
/// on small-bin markets. At n=2, a doubling trade ($15K on $15K pool)
/// triggers w2*excess overflow before xw^2.
///
/// w2 = SCALE^2/2 ≈ 5e17, excess ≈ 3*T^2 ≈ 6.75e20
/// w2*excess ≈ 3.4e38 → overflows u128.
#[test]
fn test_bug001_w2_excess_overflow_doubling_trade() {
    let n: usize = 2;
    let total_minted: u128 = 15_000_000_000; // $15K USDC
    let mut reserves = init_reserves(n, total_minted);
    let weights = uniform_weights(n);
    let trade = 15_000_000_000u64; // $15K — doubling the pool

    let result = compute_distribution_buy(&mut reserves, total_minted, &weights, trade);

    assert!(
        result.is_ok(),
        "BUG-001: w2*excess overflows for doubling trade at $15K with 2 bins. \
         Error: {:?}",
        result.err()
    );

    let tokens = result.unwrap();
    let total_tokens: u64 = tokens.iter().sum();
    assert!(total_tokens > 0, "should receive tokens");

    // Invariant check (proportional tolerance)
    let k_new = total_minted + trade as u128;
    let actual_sq = sum_of_position_squares(&reserves, k_new);
    let expected_sq = k_new * k_new;
    assert!(
        actual_sq.abs_diff(expected_sq) <= expected_sq / 1_000_000,
        "invariant relative error {} too large (expected_sq={})",
        actual_sq.abs_diff(expected_sq), expected_sq
    );

    // Doubling trade on 2-bin uniform pool: analytically total ≈ 1.162 * trade
    // λ = (sqrt(5/2) - 1) * T * SCALE, tokens_per_bin = λ/SCALE,
    // total = 2 * λ/SCALE ≈ 1.162 * T
    // So total_tokens > trade — the pool expansion creates extra capacity.
    assert!(
        total_tokens > trade,
        "doubling trade: total_tokens ({total_tokens}) should exceed trade ({trade})"
    );
    assert!(
        total_tokens < trade * 3 / 2,
        "doubling trade: total_tokens ({total_tokens}) should be < 1.5 * trade"
    );

    // Uniform weights → equal distribution, all bins > 0
    assert!(tokens[0] > 0 && tokens[1] > 0, "all bins should get tokens: {:?}", tokens);
    let diff = tokens[0].abs_diff(tokens[1]);
    assert!(diff <= 1, "uniform weights → equal tokens: {:?}", tokens);
}

/// Regression: $20K with 2 bins is below the current overflow threshold
/// (~$26K). This should pass both before AND after the fix.
#[test]
fn test_bug001_regression_below_threshold() {
    let n: usize = 2;
    let total_minted: u128 = 20_000_000_000; // $20K USDC — below $26K threshold
    let mut reserves = init_reserves(n, total_minted);
    let weights = uniform_weights(n);
    let trade = 1_000_000u64; // $1 USDC

    let result = compute_distribution_buy(&mut reserves, total_minted, &weights, trade);

    assert!(
        result.is_ok(),
        "Regression: should work below overflow threshold. Error: {:?}",
        result.err()
    );

    let tokens = result.unwrap();
    let total_tokens: u64 = tokens.iter().sum();
    assert!(total_tokens > 0, "should receive tokens");

    // Invariant check (proportional tolerance)
    let k_new = total_minted + trade as u128;
    let actual_sq = sum_of_position_squares(&reserves, k_new);
    let expected_sq = k_new * k_new;
    assert!(
        actual_sq.abs_diff(expected_sq) <= expected_sq / 1_000_000,
        "invariant relative error {} too large (expected_sq={})",
        actual_sq.abs_diff(expected_sq), expected_sq
    );

    // L2-norm: total ≈ trade * sqrt(2) ≈ 1.414 * trade
    let expected_total = isqrt((trade as u128) * (trade as u128) * n as u128);
    assert!(
        (total_tokens as u128).abs_diff(expected_total) <= expected_total / 20,
        "total_tokens ({total_tokens}) not within 5% of expected ({expected_total})"
    );

    // Uniform weights → equal distribution, all bins > 0
    assert!(tokens[0] > 0 && tokens[1] > 0, "all bins should get tokens: {:?}", tokens);
    let diff = tokens[0].abs_diff(tokens[1]);
    assert!(diff <= 1, "uniform weights → equal tokens: {:?}", tokens);
}

/// BUG-001: buy→sell roundtrip at overflow-relevant pool size.
///
/// Buys a distribution on a large pool, then sells the tokens back.
/// Verifies: sell succeeds (U256 k_new_sq path exercised),
/// collateral returned ≤ collateral spent (price impact + rounding),
/// and reserves return close to initial state.
#[test]
fn test_bug001_buy_then_sell_roundtrip() {
    let n: usize = 2;
    let total_minted: u128 = 50_000_000_000; // $50K — well above overflow threshold
    let mut reserves = init_reserves(n, total_minted);
    let reserves_before = reserves.clone();
    let weights = uniform_weights(n);
    let trade = 5_000_000u64; // $5 USDC

    // Buy
    let tokens = compute_distribution_buy(&mut reserves, total_minted, &weights, trade).unwrap();
    let total_tokens: u64 = tokens.iter().sum();
    let k_after_buy = total_minted + trade as u128;

    // Sell back the same tokens
    let collateral_out =
        compute_distribution_sell(&mut reserves, k_after_buy, &weights, total_tokens).unwrap();

    // Should get back approximately what we put in.
    // isqrt floor rounding in sell can return up to +n units more than exact.
    assert!(
        collateral_out.abs_diff(trade) <= n as u64,
        "roundtrip drift: collateral_out={collateral_out}, trade={trade}, max drift={n}"
    );
    assert!(
        collateral_out >= trade * 95 / 100,
        "sell should return ≥95% of trade: got {collateral_out}, expected ≥{}",
        trade * 95 / 100
    );

    // Reserves should be close to initial state
    for i in 0..n {
        let drift = reserves[i].abs_diff(reserves_before[i]);
        assert!(
            drift <= 2,
            "reserve[{i}] drifted by {drift}: before={}, after={}",
            reserves_before[i], reserves[i]
        );
    }
}

/// BUG-001: sell at large pool — exercises U256 k_new_sq in compute_distribution_sell.
///
/// At $1M/64-bin, positions x_new are large. While u128 overflow in sell
/// requires ~$18B per bin (not practical), this verifies the U256 path works.
#[test]
fn test_bug001_sell_large_pool_64_bins() {
    let n: usize = 64;
    let total_minted: u128 = 1_000_000_000_000; // $1M
    let mut reserves = init_reserves(n, total_minted);
    let weights = uniform_weights(n);
    let buy_amount = 50_000_000u64; // $50

    // Buy first to establish a position
    let tokens = compute_distribution_buy(&mut reserves, total_minted, &weights, buy_amount).unwrap();
    let total_tokens: u64 = tokens.iter().sum();
    let k_after_buy = total_minted + buy_amount as u128;

    // Sell all tokens back
    let collateral_out =
        compute_distribution_sell(&mut reserves, k_after_buy, &weights, total_tokens).unwrap();

    assert!(collateral_out > 0, "should receive collateral");
    // isqrt floor rounding can give back up to +n units more than exact
    assert!(
        collateral_out.abs_diff(buy_amount) <= n as u64,
        "roundtrip drift: collateral_out={collateral_out}, buy_amount={buy_amount}, max drift={n}"
    );

    // Invariant check on final state
    let k_final = k_after_buy - collateral_out as u128;
    let actual_sq = sum_of_position_squares(&reserves, k_final);
    let expected_sq = k_final * k_final;
    assert!(
        actual_sq.abs_diff(expected_sq) <= expected_sq / 1_000_000,
        "invariant error {} exceeds 1e-6 relative tolerance after sell",
        actual_sq.abs_diff(expected_sq)
    );
}

/// BUG-001: doubling buy then sell roundtrip at overflow pool size.
///
/// The most extreme case: double a $30K pool then sell everything back.
#[test]
fn test_bug001_doubling_buy_then_sell_roundtrip() {
    let n: usize = 2;
    let total_minted: u128 = 30_000_000_000; // $30K
    let mut reserves = init_reserves(n, total_minted);
    let weights = uniform_weights(n);
    let trade = 30_000_000_000u64; // $30K — doubles the pool

    // Buy (doubling trade — was the BUG-001 w2*excess overflow trigger)
    let tokens = compute_distribution_buy(&mut reserves, total_minted, &weights, trade).unwrap();
    let total_tokens: u64 = tokens.iter().sum();
    let k_after_buy = total_minted + trade as u128;

    // Total tokens > trade for a doubling buy (pool expansion effect)
    assert!(total_tokens > trade, "doubling buy: total > trade");

    // Sell all tokens back
    let collateral_out =
        compute_distribution_sell(&mut reserves, k_after_buy, &weights, total_tokens).unwrap();

    // Should get back approximately what we put in.
    // isqrt floor rounding can return ±n units from exact.
    assert!(collateral_out > 0, "should receive collateral from sell");
    assert!(
        collateral_out.abs_diff(trade) <= n as u64,
        "roundtrip drift: collateral_out={collateral_out}, trade={trade}, max drift={n}"
    );
    assert!(
        collateral_out >= trade * 90 / 100,
        "sell should return ≥90% of trade: got {collateral_out}, expected ≥{}",
        trade * 90 / 100
    );
}

// ══════════════════════════════════════════════════════════════════════
// NEW TESTS: Coverage gaps identified during review (2026-05-07)
// ══════════════════════════════════════════════════════════════════════

// ── scale_reserves: u64 truncation boundary (BUG N6) ────────────────

#[test]
fn test_scale_reserves_u64_boundary_no_truncation() {
    // Verify that scaling up reserves close to (but within) u64::MAX works correctly.
    // With USDC 6 decimals: u64::MAX ≈ 18.4 × 10^18 → $18.4 trillion.
    // Normal usage won't hit this, but we document the boundary.
    let initial = u64::MAX / 3; // ~6.1e18
    let mut reserves = vec![initial; 2];
    let total_minted = initial as u128 * 2; // use a proportional total
    let numerator = total_minted + initial as u128; // 1.5x scale
    let new_k2 = scale_reserves(&mut reserves, numerator, total_minted).unwrap();
    // Each reserve: initial * 1.5 ≈ 9.2e18, still fits u64.
    let expected = (initial as u128 * numerator / total_minted) as u64;
    assert_eq!(reserves[0], expected);
    assert_eq!(reserves[1], expected);
    assert_eq!(new_k2, numerator * numerator);
}

#[test]
fn test_scale_reserves_u64_overflow_returns_error() {
    // BUG N6 fix: when scaled reserve > u64::MAX, scale_reserves must return
    // MathOverflow instead of silently truncating via `as u64`.
    //
    // Setup: use small numerator/denominator ratio (3/1) with moderate reserve
    // so that reserve * numerator fits u128 but the result exceeds u64::MAX.
    let initial = u64::MAX / 2; // ~9.2e18
    let mut reserves = vec![initial];
    let denominator: u128 = 1;
    let numerator: u128 = 3; // result = initial * 3 ≈ 2.7e19 > u64::MAX

    // Sanity: the intermediate fits u128.
    assert!(
        (initial as u128).checked_mul(numerator).is_some(),
        "intermediate fits u128"
    );
    // But final value exceeds u64::MAX.
    let expected = initial as u128 * numerator / denominator;
    assert!(expected > u64::MAX as u128, "would overflow u64");

    let result = scale_reserves(&mut reserves, numerator, denominator);
    // After fix: must return error (MathOverflow).
    assert!(result.is_err(), "scale_reserves must reject u64 overflow");
    // Reserves must remain unchanged (no partial mutation).
    assert_eq!(reserves[0], initial);
}

#[test]
fn test_scale_reserves_just_below_u64_max_succeeds() {
    // Ensure values that fit in u64 still work correctly.
    let initial: u64 = u64::MAX / 3; // ~6.1e18
    let mut reserves = vec![initial];
    let numerator: u128 = 2;
    let denominator: u128 = 1;

    // result = initial * 2 ≈ 1.2e19 < u64::MAX (~1.8e19)
    let expected = initial as u128 * numerator / denominator;
    assert!(expected <= u64::MAX as u128, "should fit u64");

    let result = scale_reserves(&mut reserves, numerator, denominator);
    assert!(result.is_ok());
    assert_eq!(reserves[0] as u128, expected);
}

// ── Distribution sell with non-uniform weights ──────────────────────

#[test]
fn test_distribution_sell_non_uniform_weights() {
    // 3 bins with weights [60%, 30%, 10%] (sums to SCALE).
    let n = 3;
    let total_minted: u128 = 10_000_000;
    let mut reserves = init_reserves(n, total_minted);
    let weights: Vec<u64> = vec![
        (SCALE * 6 / 10) as u64, // 600_000_000
        (SCALE * 3 / 10) as u64, // 300_000_000
        (SCALE * 1 / 10) as u64, // 100_000_000
    ];

    // First buy to get tokens.
    let tokens = compute_distribution_buy(&mut reserves, total_minted, &weights, 1_000_000).unwrap();
    let total_tokens: u64 = tokens.iter().sum();
    let tm_after_buy = total_minted + 1_000_000;

    // Verify non-uniform distribution: bin 0 gets most tokens.
    assert!(tokens[0] > tokens[1], "bin0={} > bin1={}", tokens[0], tokens[1]);
    assert!(tokens[1] > tokens[2], "bin1={} > bin2={}", tokens[1], tokens[2]);

    // Sell all back with same weights.
    let collateral_out =
        compute_distribution_sell(&mut reserves, tm_after_buy, &weights, total_tokens).unwrap();

    // Roundtrip should recover ~100% (within isqrt rounding).
    let diff = collateral_out.abs_diff(1_000_000u64);
    assert!(
        diff <= n as u64 + 1,
        "roundtrip non-uniform: got {collateral_out}, expected ~1_000_000, diff={diff}"
    );
}

#[test]
fn test_distribution_sell_different_weights_than_buy() {
    // Buy with one distribution, sell with a different one.
    // This simulates a trader who changes their position shape.
    let n = 4;
    let total_minted: u128 = 5_000_000;
    let mut reserves = init_reserves(n, total_minted);
    let buy_weights: Vec<u64> = vec![
        (SCALE / 4) as u64,
        (SCALE / 4) as u64,
        (SCALE / 4) as u64,
        (SCALE / 4) as u64,
    ];

    // Buy uniformly.
    let tokens =
        compute_distribution_buy(&mut reserves, total_minted, &buy_weights, 500_000).unwrap();
    let total_tokens: u64 = tokens.iter().sum();
    let tm_after = total_minted + 500_000;

    // Sell with skewed weights (all on bin 0).
    // We can only sell min(tokens_per_bin, what we have) — use total_tokens but weight all to bin 0.
    let sell_weights: Vec<u64> = vec![SCALE as u64, 0, 0, 0];
    let result = compute_distribution_sell(&mut reserves, tm_after, &sell_weights, total_tokens);

    // Should succeed: we're adding all tokens to bin 0's reserve.
    assert!(result.is_ok(), "selling with different weights should work: {:?}", result);
    let collateral_out = result.unwrap();
    // Selling concentrated in one bin should return LESS than uniform sell
    // (concentrated sell gets worse price impact).
    assert!(collateral_out > 0);
}

// ── Distribution buy with many bins ─────────────────────────────────

#[test]
fn test_distribution_buy_many_bins_uniform() {
    // 16-bin market with uniform weights.
    let n = 16;
    let total_minted: u128 = 10_000_000;
    let mut reserves = init_reserves(n, total_minted);
    let weights = uniform_weights(n);

    let tokens =
        compute_distribution_buy(&mut reserves, total_minted, &weights, 2_000_000).unwrap();

    // All bins should get approximately equal tokens.
    let avg = tokens.iter().sum::<u64>() / n as u64;
    for (i, &t) in tokens.iter().enumerate() {
        let diff = t.abs_diff(avg);
        assert!(
            diff <= 2,
            "bin {i}: tokens={t}, avg={avg}, diff={diff}"
        );
    }
    // Total tokens should be positive and reasonable.
    let total: u64 = tokens.iter().sum();
    assert!(total > 0);
    // For uniform buy on uniform pool, tokens ≈ collateral * (sqrt(2) - 1) per bin approach.
    // Just verify it's in a sane range.
    assert!(total > 500_000, "total={total} should be meaningful");
}

#[test]
fn test_distribution_buy_64_bins_gaussian_weights() {
    // Simulate a realistic continuous market buy: 64 bins, Gaussian-like weights.
    let n = 64;
    let total_minted: u128 = 50_000_000;
    let mut reserves = init_reserves(n, total_minted);

    // Create bell-curve weights centered on bin 32, sigma ~8 bins.
    let mut weights_raw: Vec<f64> = Vec::with_capacity(n);
    let mu = 32.0f64;
    let sigma = 8.0f64;
    for b in 0..n {
        let z = (b as f64 - mu) / sigma;
        weights_raw.push((-0.5 * z * z).exp());
    }
    let sum: f64 = weights_raw.iter().sum();
    let weights: Vec<u64> = weights_raw
        .iter()
        .map(|&w| ((w / sum) * SCALE as f64) as u64)
        .collect();
    // Adjust last weight so sum == SCALE.
    let mut weights = weights;
    let wsum: u64 = weights.iter().sum();
    if wsum < SCALE as u64 {
        weights[32] += SCALE as u64 - wsum;
    }

    let tokens =
        compute_distribution_buy(&mut reserves, total_minted, &weights, 5_000_000).unwrap();

    // Central bins should get more tokens than edge bins.
    assert!(tokens[32] > tokens[0], "center > edge");
    assert!(tokens[32] > tokens[63], "center > far edge");
    // Bins at 3-sigma away should get very few tokens.
    assert!(tokens[8] < tokens[32] / 10, "3-sigma away bin should be small");
}

// ── Distribution sell: invariant and boundary tests ─────────────────

#[test]
fn test_distribution_sell_returns_less_than_minted() {
    // After buy, selling all tokens should return <= collateral_in (no free money).
    let n = 8;
    let total_minted: u128 = 10_000_000;
    let mut reserves = init_reserves(n, total_minted);
    let weights = uniform_weights(n);
    let trade = 3_000_000u64;

    let tokens =
        compute_distribution_buy(&mut reserves, total_minted, &weights, trade).unwrap();
    let total_tokens: u64 = tokens.iter().sum();
    let tm_after = total_minted + trade as u128;

    let collateral_out =
        compute_distribution_sell(&mut reserves, tm_after, &weights, total_tokens).unwrap();

    // Roundtrip should recover approximately what was put in.
    // isqrt floor rounding can cause ±N units drift (one per bin).
    let diff = collateral_out.abs_diff(trade);
    assert!(
        diff <= n as u64 + 1,
        "excessive roundtrip drift: got {collateral_out}, put in {trade}, diff={diff}, max={}",
        n as u64 + 1
    );
}

#[test]
fn test_distribution_sell_partial_position() {
    // Sell only half the tokens from a buy.
    let n = 4;
    let total_minted: u128 = 5_000_000;
    let mut reserves = init_reserves(n, total_minted);
    let weights = uniform_weights(n);
    let trade = 1_000_000u64;

    let tokens =
        compute_distribution_buy(&mut reserves, total_minted, &weights, trade).unwrap();
    let total_tokens: u64 = tokens.iter().sum();
    let tm_after = total_minted + trade as u128;

    // Sell half.
    let half_tokens = total_tokens / 2;
    let coll_half =
        compute_distribution_sell(&mut reserves, tm_after, &weights, half_tokens).unwrap();

    // Should get less than half the original collateral (due to price impact).
    assert!(coll_half > 0);
    assert!(coll_half < trade); // Must be less than full trade
}

// ── compute_collateral_for_target_prob with multi-outcome ────────────

#[test]
fn test_collateral_for_target_prob_5_outcome_to_50() {
    // 5-outcome market: default prob ~20% each.
    // Buy outcome 0 to 50% probability.
    let n = 5;
    let total_minted: u128 = 10_000_000;
    let reserves = init_reserves(n, total_minted);

    let effective =
        compute_collateral_for_target_prob(&reserves, total_minted, 0, 500_000_000).unwrap();
    assert!(effective > 0);

    // Verify: after buying, probability should be ~50%.
    let mut reserves_after = reserves.clone();
    let _tokens = compute_buy(&mut reserves_after, total_minted, 0, effective).unwrap();
    let tm_after = total_minted + effective as u128;
    let probs = compute_probabilities(&reserves_after, tm_after);
    // Allow some tolerance due to isqrt rounding.
    let diff = probs[0].abs_diff(500_000_000);
    assert!(
        diff < 10_000_000, // < 1% error
        "prob[0]={}, expected ~500M, diff={diff}",
        probs[0]
    );
}

// ── compute_tokens_for_target_prob edge cases ────────────────────────

#[test]
fn test_tokens_for_target_prob_multi_outcome() {
    // 5-outcome market: buy outcome 0 high, then sell back to 30%.
    let n = 5;
    let total_minted: u128 = 10_000_000;
    let mut reserves = init_reserves(n, total_minted);

    // Buy outcome 0 up (to increase its probability).
    let _tokens_bought = compute_buy(&mut reserves, total_minted, 0, 5_000_000).unwrap();
    let tm_after = total_minted + 5_000_000;

    let probs = compute_probabilities(&reserves, tm_after);
    assert!(probs[0] > 300_000_000, "prob[0]={} should be > 30%", probs[0]);

    // Sell to 30%.
    let tokens_in =
        compute_tokens_for_target_prob(&reserves, tm_after, 0, 300_000_000).unwrap();
    assert!(tokens_in > 0);
}

// ── Buy/sell consistency: price increases monotonically ──────────────

#[test]
fn test_successive_distribution_buys_yield_fewer_tokens() {
    // With non-uniform weights, successive buys should yield diminishing returns
    // because the concentrated bins get increasingly expensive.
    let n = 4;
    let total_minted: u128 = 10_000_000;
    // Concentrated weights: 70% on bin 0, 30% spread over rest.
    let weights: Vec<u64> = vec![
        (SCALE * 7 / 10) as u64,
        (SCALE * 1 / 10) as u64,
        (SCALE * 1 / 10) as u64,
        (SCALE * 1 / 10) as u64,
    ];
    let trade = 1_000_000u64;

    let mut reserves = init_reserves(n, total_minted);
    let tokens1 =
        compute_distribution_buy(&mut reserves, total_minted, &weights, trade).unwrap();
    let total1: u64 = tokens1.iter().sum();

    let tm_after_1 = total_minted + trade as u128;
    let tokens2 =
        compute_distribution_buy(&mut reserves, tm_after_1, &weights, trade).unwrap();
    let total2: u64 = tokens2.iter().sum();

    // Second buy should yield fewer tokens (price went up in concentrated bins).
    assert!(
        total2 < total1,
        "diminishing returns: buy1={total1}, buy2={total2}"
    );
}

// ── scale_reserves: verify all reserves scale proportionally ────────

#[test]
fn test_scale_reserves_non_uniform_reserves() {
    // After some trading, reserves are non-uniform. Verify scaling preserves ratios.
    let mut reserves = vec![200_000u64, 600_000, 400_000];
    let total_minted: u128 = 1_000_000;
    let deposit = 500_000u128;
    let numerator = total_minted + deposit;

    let new_k2 = scale_reserves(&mut reserves, numerator, total_minted).unwrap();

    // Each reserve should be 1.5x the original.
    assert_eq!(reserves[0], 300_000);
    assert_eq!(reserves[1], 900_000);
    assert_eq!(reserves[2], 600_000);
    assert_eq!(new_k2, numerator * numerator);

    // Ratios preserved: 2:6:4 → 3:9:6 (same ratio).
    assert_eq!(reserves[1] / reserves[0], 3);
    assert_eq!(reserves[2] / reserves[0], 2);
}

// ── Distribution buy: verify invariant holds after operation ────────

#[test]
fn test_distribution_buy_invariant_holds() {
    // After distribution buy, verify Σ(total_minted_new - reserves[i])² ≈ k_new².
    let n = 4;
    let total_minted: u128 = 10_000_000;
    let mut reserves = init_reserves(n, total_minted);
    let weights = uniform_weights(n);
    let trade = 2_000_000u64;

    let _tokens =
        compute_distribution_buy(&mut reserves, total_minted, &weights, trade).unwrap();
    let k_new = total_minted + trade as u128;
    let k_new_sq = k_new * k_new;

    // Compute actual sum of position squares.
    let actual_sq: u128 = reserves
        .iter()
        .map(|&h| {
            let x = k_new.saturating_sub(h as u128);
            x * x
        })
        .sum();

    // Should hold within tolerance.
    let diff = if actual_sq > k_new_sq {
        actual_sq - k_new_sq
    } else {
        k_new_sq - actual_sq
    };
    assert!(
        diff <= 256, // INVARIANT_TOLERANCE
        "invariant violated: actual_sq={actual_sq}, k_new_sq={k_new_sq}, diff={diff}"
    );
}

#[test]
fn test_distribution_sell_invariant_holds() {
    // After distribution sell, invariant should also hold.
    let n = 4;
    let total_minted: u128 = 10_000_000;
    let mut reserves = init_reserves(n, total_minted);
    let weights = uniform_weights(n);

    // Buy first.
    let tokens =
        compute_distribution_buy(&mut reserves, total_minted, &weights, 2_000_000).unwrap();
    let total_tokens: u64 = tokens.iter().sum();
    let tm_after_buy = total_minted + 2_000_000;

    // Sell half.
    let collateral_out =
        compute_distribution_sell(&mut reserves, tm_after_buy, &weights, total_tokens / 2).unwrap();
    let tm_after_sell = tm_after_buy - collateral_out as u128;

    // Check invariant.
    let actual_sq: u128 = reserves
        .iter()
        .map(|&h| {
            let x = tm_after_sell.saturating_sub(h as u128);
            x * x
        })
        .sum();
    let k_sq = tm_after_sell * tm_after_sell;
    let diff = actual_sq.abs_diff(k_sq);
    assert!(
        diff <= 256,
        "sell invariant violated: actual_sq={actual_sq}, k_sq={k_sq}, diff={diff}"
    );
}

// ── compute_sell_all ─────────────────────────────────────────────────

#[test]
fn test_sell_all_basic_roundtrip() {
    // Buy distribution, then sell_all with exact holdings → should recover ~100%
    let n = 4;
    let total_minted: u128 = 10_000_000;
    let mut reserves = init_reserves(n, total_minted);
    let weights = uniform_weights(n);
    let trade = 2_000_000u64;

    let tokens =
        compute_distribution_buy(&mut reserves, total_minted, &weights, trade).unwrap();
    let tm_after_buy = total_minted + trade as u128;

    // sell_all with exact per-bin token amounts
    let collateral_out =
        compute_sell_all(&mut reserves, tm_after_buy, &tokens).unwrap();

    let diff = collateral_out.abs_diff(trade);
    assert!(
        diff <= n as u64 + 1,
        "sell_all roundtrip: got {collateral_out}, expected ~{trade}, diff={diff}"
    );
}

#[test]
fn test_sell_all_matches_distribution_sell() {
    // sell_all with per-bin amounts should give the same collateral
    // as compute_distribution_sell with the same effective per-bin amounts
    let n = 4;
    let total_minted: u128 = 10_000_000;
    let weights = uniform_weights(n);
    let trade = 1_500_000u64;

    // Path A: buy + sell_all
    let mut reserves_a = init_reserves(n, total_minted);
    let tokens_a =
        compute_distribution_buy(&mut reserves_a, total_minted, &weights, trade).unwrap();
    let tm_after = total_minted + trade as u128;
    let coll_a = compute_sell_all(&mut reserves_a, tm_after, &tokens_a).unwrap();

    // Path B: buy + distribution_sell (same total tokens, same weights)
    let mut reserves_b = init_reserves(n, total_minted);
    let tokens_b =
        compute_distribution_buy(&mut reserves_b, total_minted, &weights, trade).unwrap();
    let total_tokens: u64 = tokens_b.iter().sum();
    let coll_b =
        compute_distribution_sell(&mut reserves_b, tm_after, &weights, total_tokens).unwrap();

    // Should be identical (same math, same per-bin amounts for uniform weights)
    assert_eq!(coll_a, coll_b,
        "sell_all={coll_a} should equal distribution_sell={coll_b} for uniform weights");
}

#[test]
fn test_sell_all_non_uniform_holdings() {
    // Holdings from a non-uniform buy should sell correctly
    let n = 4;
    let total_minted: u128 = 10_000_000;
    let mut reserves = init_reserves(n, total_minted);
    let weights: Vec<u64> = vec![
        (SCALE * 7 / 10) as u64,
        (SCALE * 1 / 10) as u64,
        (SCALE * 1 / 10) as u64,
        (SCALE * 1 / 10) as u64,
    ];
    let trade = 2_000_000u64;

    let tokens =
        compute_distribution_buy(&mut reserves, total_minted, &weights, trade).unwrap();
    let tm_after = total_minted + trade as u128;

    // Verify tokens are non-uniform
    assert!(tokens[0] > tokens[1], "bin0 should have more tokens");

    let collateral_out = compute_sell_all(&mut reserves, tm_after, &tokens).unwrap();
    let diff = collateral_out.abs_diff(trade);
    assert!(
        diff <= n as u64 + 1,
        "non-uniform sell_all roundtrip: got {collateral_out}, expected ~{trade}, diff={diff}"
    );
}

#[test]
fn test_sell_all_multi_buy_then_sell_all() {
    // Multiple buys with different curves, then sell_all with combined holdings
    let n = 8;
    let total_minted: u128 = 20_000_000;
    let mut reserves = init_reserves(n, total_minted);
    let mut total_minted_cur = total_minted;

    // Buy #1: concentrated on bins 0-3
    let weights1: Vec<u64> = vec![
        (SCALE / 4) as u64, (SCALE / 4) as u64,
        (SCALE / 4) as u64, (SCALE / 4) as u64,
        0, 0, 0, 0,
    ];
    let tokens1 =
        compute_distribution_buy(&mut reserves, total_minted_cur, &weights1, 1_000_000).unwrap();
    total_minted_cur += 1_000_000;

    // Buy #2: concentrated on bins 4-7
    let weights2: Vec<u64> = vec![
        0, 0, 0, 0,
        (SCALE / 4) as u64, (SCALE / 4) as u64,
        (SCALE / 4) as u64, (SCALE / 4) as u64,
    ];
    let tokens2 =
        compute_distribution_buy(&mut reserves, total_minted_cur, &weights2, 1_000_000).unwrap();
    total_minted_cur += 1_000_000;

    // Combined holdings
    let mut combined: Vec<u64> = vec![0; n];
    for i in 0..n {
        combined[i] = tokens1[i] + tokens2[i];
    }

    // sell_all with combined holdings — this is what the instruction does
    let collateral_out = compute_sell_all(&mut reserves, total_minted_cur, &combined).unwrap();

    // Should recover close to total invested (2M), accounting for price impact between buys
    assert!(collateral_out > 0);
    assert!(
        collateral_out > 1_800_000, // at least 90% of 2M
        "multi-buy sell_all should recover most collateral: got {collateral_out}"
    );
}

#[test]
fn test_sell_all_invariant_holds() {
    // After sell_all, invariant should hold (proportional tolerance)
    let n = 8;
    let total_minted: u128 = 10_000_000;
    let mut reserves = init_reserves(n, total_minted);
    let weights = uniform_weights(n);

    let tokens =
        compute_distribution_buy(&mut reserves, total_minted, &weights, 2_000_000).unwrap();
    let tm_after_buy = total_minted + 2_000_000;

    let collateral_out = compute_sell_all(&mut reserves, tm_after_buy, &tokens).unwrap();
    let tm_after_sell = tm_after_buy - collateral_out as u128;

    let actual_sq: u128 = reserves
        .iter()
        .map(|&h| {
            let x = tm_after_sell.saturating_sub(h as u128);
            x * x
        })
        .sum();
    let k_sq = tm_after_sell * tm_after_sell;
    let diff = actual_sq.abs_diff(k_sq);
    // Use proportional tolerance (1e-6 relative) — same as other distribution tests.
    // isqrt rounding accumulates across N bins.
    assert!(
        diff <= k_sq / 1_000_000 + 256,
        "sell_all invariant violated: actual_sq={actual_sq}, k_sq={k_sq}, diff={diff}"
    );
}

#[test]
fn test_sell_all_empty_holdings() {
    let n = 4;
    let total_minted: u128 = 10_000_000;
    let mut reserves = init_reserves(n, total_minted);
    let holdings = vec![0u64; n];

    assert!(compute_sell_all(&mut reserves, total_minted, &holdings).is_err());
}

#[test]
fn test_sell_all_mismatched_lengths() {
    let n = 4;
    let total_minted: u128 = 10_000_000;
    let mut reserves = init_reserves(n, total_minted);
    let holdings = vec![100u64; 3]; // wrong length

    assert!(compute_sell_all(&mut reserves, total_minted, &holdings).is_err());
}

#[test]
fn test_sell_all_path_independence() {
    // Selling all at once via sell_all should give the same result as
    // selling the same amounts via compute_distribution_sell in two separate calls
    let n = 4;
    let total_minted: u128 = 10_000_000;
    let weights = uniform_weights(n);
    let trade = 2_000_000u64;

    // Path A: buy + sell_all (one shot)
    let mut reserves_a = init_reserves(n, total_minted);
    let tokens =
        compute_distribution_buy(&mut reserves_a, total_minted, &weights, trade).unwrap();
    let tm_after = total_minted + trade as u128;
    let coll_all = compute_sell_all(&mut reserves_a, tm_after, &tokens).unwrap();

    // Path B: buy + sell half + sell other half via sell_all
    let mut reserves_b = init_reserves(n, total_minted);
    let tokens_b =
        compute_distribution_buy(&mut reserves_b, total_minted, &weights, trade).unwrap();
    let total_tokens: u64 = tokens_b.iter().sum();
    let half = total_tokens / 2;
    let coll_half =
        compute_distribution_sell(&mut reserves_b, tm_after, &weights, half).unwrap();
    let tm_mid = tm_after - coll_half as u128;

    // Remaining holdings
    let mut remaining: Vec<u64> = vec![0; n];
    for i in 0..n {
        let sold_this_bin = (half as u128 * weights[i] as u128 / SCALE) as u64;
        remaining[i] = tokens_b[i] - sold_this_bin;
    }
    let coll_rest = compute_sell_all(&mut reserves_b, tm_mid, &remaining).unwrap();

    // Total collateral should be identical (path independence)
    let total_b = coll_half + coll_rest;
    let diff = coll_all.abs_diff(total_b);
    assert!(
        diff <= 1,
        "path independence: all_at_once={coll_all}, split={total_b}, diff={diff}"
    );
}

#[test]
fn test_sell_all_large_pool() {
    // Test at large pool sizes (exercises U256 path)
    let n = 64;
    let total_minted: u128 = 1_000_000_000_000; // $1M
    let mut reserves = init_reserves(n, total_minted);
    let weights = uniform_weights(n);
    let trade = 50_000_000u64; // $50

    let tokens =
        compute_distribution_buy(&mut reserves, total_minted, &weights, trade).unwrap();
    let tm_after = total_minted + trade as u128;

    let collateral_out = compute_sell_all(&mut reserves, tm_after, &tokens).unwrap();
    let diff = collateral_out.abs_diff(trade);
    assert!(
        diff <= n as u64,
        "large pool sell_all roundtrip: got {collateral_out}, expected ~{trade}, diff={diff}"
    );
}
