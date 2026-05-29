use anchor_lang::prelude::*;
use dekant_pm::state::market::{Market, FeeBreakdown, MarketType, MarketState};
use dekant_pm::constants::*;
use dekant_pm::errors::DekantPmError;

const TEST_DEADLINE: i64 = 1_000_000;
const TEST_CREATED_AT: i64 = 500_000;
const TEST_LIQUIDITY: u64 = 1_000_000; // 1 USDC

fn blank_market() -> Market {
    Market {
        version: 0,
        market_id: 0,
        market_type: 0,
        state: 0,
        creator: Pubkey::default(),
        oracle: Pubkey::default(),
        collateral_mint: Pubkey::default(),
        vault: Pubkey::default(),
        deadline: 0,
        created_at: 0,
        resolved_at: 0,
        num_outcomes: 0,
        k_squared: 0,
        total_minted: 0,
        lp_shares_total: 0,
        lp_fee_accumulated: 0,
        protocol_fee_accumulated: 0,
        range_min: 0,
        range_max: 0,
        resolved_outcome: 0,
        resolved_value: 0,
        bump: 255,
        vault_authority_bump: 254,
        _padding: [0u8; 30],
        reserves: vec![],
        trader_token_totals: vec![],
    }
}

fn init_binary(m: &mut Market) {
    m.initialize(
        1,
        MARKET_TYPE_BINARY,
        Pubkey::default(),
        Pubkey::default(),
        Pubkey::default(),
        Pubkey::default(),
        TEST_DEADLINE,
        TEST_CREATED_AT,
        2,
        TEST_LIQUIDITY,
        0,
        0,
        255,
        254,
    )
    .unwrap();
}

fn init_continuous(m: &mut Market, num_bins: u16) {
    m.initialize(
        2,
        MARKET_TYPE_CONTINUOUS,
        Pubkey::default(),
        Pubkey::default(),
        Pubkey::default(),
        Pubkey::default(),
        TEST_DEADLINE,
        TEST_CREATED_AT,
        num_bins,
        TEST_LIQUIDITY,
        0,
        1_000_000_000, // range: [0, 10^9]
        255,
        254,
    )
    .unwrap();
}

// ── Initialization ───────────────────────────────────────────────

#[test]
fn test_initialize_binary_market() {
    let mut m = blank_market();
    init_binary(&mut m);

    assert_eq!(m.version, SCHEMA_VERSION);
    assert_eq!(m.market_type, MARKET_TYPE_BINARY);
    assert_eq!(m.state, STATE_ACTIVE);
    assert_eq!(m.num_outcomes, 2);
    // Position-based init: h = L - isqrt(L²/N), k² = L²
    let expected_reserve = 292_894u64; // 1M - isqrt(10^12/2)
    assert_eq!(m.reserves, vec![expected_reserve; 2]);
    assert_eq!(m.k_squared, (TEST_LIQUIDITY as u128).pow(2));
    assert_eq!(m.total_minted, TEST_LIQUIDITY as u128);
    assert_eq!(m.lp_shares_total, TEST_LIQUIDITY as u128);
    assert_eq!(m.range_min, 0);
    assert_eq!(m.range_max, 0);
}

#[test]
fn test_initialize_continuous_market() {
    let mut m = blank_market();
    init_continuous(&mut m, 10);

    assert_eq!(m.market_type, MARKET_TYPE_CONTINUOUS);
    assert_eq!(m.num_outcomes, 10);
    assert_eq!(m.reserves.len(), 10);
    // Position-based init: h = L - isqrt(L²/N), k² = L²
    let expected_reserve = 683_773u64; // 1M - isqrt(10^12/10)
    assert!(m.reserves.iter().all(|&r| r == expected_reserve));
    assert_eq!(m.k_squared, (TEST_LIQUIDITY as u128).pow(2));
    assert_eq!(m.range_min, 0);
    assert_eq!(m.range_max, 1_000_000_000);
}

#[test]
fn test_initialize_rejects_invalid_type() {
    let mut m = blank_market();
    let err = m
        .initialize(
            1, 255, Pubkey::default(), Pubkey::default(),
            Pubkey::default(), Pubkey::default(),
            TEST_DEADLINE, TEST_CREATED_AT, 2, TEST_LIQUIDITY, 0, 0, 255, 254,
        )
        .unwrap_err();
    assert_eq!(err, error!(DekantPmError::InvalidMarketType));
}

#[test]
fn test_initialize_rejects_wrong_num_outcomes() {
    let mut m = blank_market();
    let err = m
        .initialize(
            1, MARKET_TYPE_BINARY, Pubkey::default(), Pubkey::default(),
            Pubkey::default(), Pubkey::default(),
            TEST_DEADLINE, TEST_CREATED_AT, 3, TEST_LIQUIDITY, 0, 0, 255, 254,
        )
        .unwrap_err();
    assert_eq!(err, error!(DekantPmError::InvalidNumOutcomes));
}

#[test]
fn test_initialize_rejects_low_liquidity() {
    let mut m = blank_market();
    let err = m
        .initialize(
            1, MARKET_TYPE_BINARY, Pubkey::default(), Pubkey::default(),
            Pubkey::default(), Pubkey::default(),
            TEST_DEADLINE, TEST_CREATED_AT, 2, 999, 0, 0, 255, 254,
        )
        .unwrap_err();
    assert_eq!(err, error!(DekantPmError::LiquidityTooSmall));
}

#[test]
fn test_initialize_rejects_invalid_deadline() {
    let mut m = blank_market();
    let err = m
        .initialize(
            1, MARKET_TYPE_BINARY, Pubkey::default(), Pubkey::default(),
            Pubkey::default(), Pubkey::default(),
            TEST_CREATED_AT, TEST_CREATED_AT, 2, TEST_LIQUIDITY, 0, 0, 255, 254,
        )
        .unwrap_err();
    assert_eq!(err, error!(DekantPmError::InvalidDeadline));
}

#[test]
fn test_initialize_continuous_rejects_invalid_range() {
    let mut m = blank_market();
    let err = m
        .initialize(
            1, MARKET_TYPE_CONTINUOUS, Pubkey::default(), Pubkey::default(),
            Pubkey::default(), Pubkey::default(),
            TEST_DEADLINE, TEST_CREATED_AT, 10, TEST_LIQUIDITY, 100, 50, 255, 254,
        )
        .unwrap_err();
    assert_eq!(err, error!(DekantPmError::InvalidRange));
}

// ── State Transitions ────────────────────────────────────────────

#[test]
fn test_pause_active_market() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.pause().unwrap();
    assert!(m.is_paused());
}

#[test]
fn test_pause_non_active_fails() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.pause().unwrap();
    assert_eq!(m.pause().unwrap_err(), error!(DekantPmError::MarketNotActive));
}

#[test]
fn test_unpause_to_active() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.pause().unwrap();
    m.unpause(TEST_CREATED_AT + 1).unwrap();
    assert!(m.is_active());
}

#[test]
fn test_unpause_to_pending_when_expired() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.pause().unwrap();
    m.unpause(TEST_DEADLINE + 1).unwrap();
    assert!(m.is_pending_resolution());
}

#[test]
fn test_transition_to_pending() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.transition_to_pending().unwrap();
    assert!(m.is_pending_resolution());
}

#[test]
fn test_resolve_binary() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.transition_to_pending().unwrap();
    m.resolve(1, 0, TEST_DEADLINE + 100).unwrap();
    assert!(m.is_resolved());
    assert_eq!(m.resolved_outcome, 1);
    assert_eq!(m.resolved_at, TEST_DEADLINE + 100);
}

#[test]
fn test_resolve_continuous() {
    let mut m = blank_market();
    init_continuous(&mut m, 10);
    m.transition_to_pending().unwrap();
    m.resolve(0, 500_000_000, TEST_DEADLINE + 100).unwrap();
    assert!(m.is_resolved());
    assert_eq!(m.resolved_outcome, 5);
    assert_eq!(m.resolved_value, 500_000_000);
}

#[test]
fn test_resolve_rejects_wrong_state() {
    let mut m = blank_market();
    init_binary(&mut m);
    assert_eq!(
        m.resolve(0, 0, TEST_DEADLINE).unwrap_err(),
        error!(DekantPmError::MarketNotPendingResolution)
    );
}

#[test]
fn test_resolve_rejects_invalid_outcome() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.transition_to_pending().unwrap();
    assert_eq!(
        m.resolve(2, 0, TEST_DEADLINE).unwrap_err(),
        error!(DekantPmError::InvalidOutcome)
    );
}

#[test]
fn test_resolve_continuous_rejects_out_of_range() {
    let mut m = blank_market();
    init_continuous(&mut m, 10);
    m.transition_to_pending().unwrap();
    assert_eq!(
        m.resolve(0, 2_000_000_000, TEST_DEADLINE).unwrap_err(),
        error!(DekantPmError::ResolvedValueOutOfRange)
    );
}

// ── Trading Guards ───────────────────────────────────────────────

#[test]
fn test_require_trading_allowed_active() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.require_trading_allowed(TEST_CREATED_AT + 1).unwrap();
}

#[test]
fn test_require_trading_rejects_paused() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.pause().unwrap();
    assert_eq!(
        m.require_trading_allowed(TEST_CREATED_AT + 1).unwrap_err(),
        error!(DekantPmError::MarketNotActive)
    );
}

#[test]
fn test_require_trading_rejects_expired() {
    let mut m = blank_market();
    init_binary(&mut m);
    assert_eq!(
        m.require_trading_allowed(TEST_DEADLINE).unwrap_err(),
        error!(DekantPmError::MarketClosed)
    );
}

#[test]
fn test_require_discrete_continuous_checks() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.require_discrete().unwrap();
    assert_eq!(
        m.require_continuous().unwrap_err(),
        error!(DekantPmError::WrongMarketType)
    );

    let mut m2 = blank_market();
    init_continuous(&mut m2, 10);
    m2.require_continuous().unwrap();
    assert_eq!(
        m2.require_discrete().unwrap_err(),
        error!(DekantPmError::WrongMarketType)
    );
}

// ── Fee Computation ──────────────────────────────────────────────

#[test]
fn test_compute_fees_standard() {
    let fb = Market::compute_fees(1_000_000, 30, 5_000).unwrap();
    assert_eq!(fb.total_fee, 3_000);
    assert_eq!(fb.lp_fee, 1_500);
    assert_eq!(fb.protocol_fee, 1_500);
    assert_eq!(fb.net_amount, 997_000);
}

#[test]
fn test_compute_fees_zero() {
    let fb = Market::compute_fees(1_000_000, 0, 5_000).unwrap();
    assert_eq!(fb.total_fee, 0);
    assert_eq!(fb.lp_fee, 0);
    assert_eq!(fb.protocol_fee, 0);
    assert_eq!(fb.net_amount, 1_000_000);
}

#[test]
fn test_compute_fees_max() {
    let fb = Market::compute_fees(1_000_000, 5_000, 5_000).unwrap();
    assert_eq!(fb.total_fee, 500_000);
    assert_eq!(fb.net_amount, 500_000);
}

#[test]
fn test_compute_fees_small_amount_floors_to_zero() {
    let fb = Market::compute_fees(1, 30, 5_000).unwrap();
    assert_eq!(fb.total_fee, 0);
    assert_eq!(fb.net_amount, 1);
}

#[test]
fn test_accrue_fees() {
    let mut m = blank_market();
    init_binary(&mut m);
    let fb = FeeBreakdown {
        total_fee: 3_000,
        lp_fee: 1_500,
        protocol_fee: 1_500,
        net_amount: 997_000,
    };
    m.accrue_fees(&fb).unwrap();
    assert_eq!(m.lp_fee_accumulated, 1_500);
    assert_eq!(m.protocol_fee_accumulated, 1_500);

    m.accrue_fees(&fb).unwrap();
    assert_eq!(m.lp_fee_accumulated, 3_000);
    assert_eq!(m.protocol_fee_accumulated, 3_000);
}

// ── Continuous Helpers ────────────────────────────────────────────

#[test]
fn test_value_to_bin_midpoint() {
    let mut m = blank_market();
    init_continuous(&mut m, 10);
    assert_eq!(m.value_to_bin(500_000_000).unwrap(), 5);
}

#[test]
fn test_value_to_bin_boundaries() {
    let mut m = blank_market();
    init_continuous(&mut m, 10);
    assert_eq!(m.value_to_bin(0).unwrap(), 0);
    assert_eq!(m.value_to_bin(1_000_000_000).unwrap(), 9);
    assert_eq!(m.value_to_bin(999_999_999).unwrap(), 9);
}

#[test]
fn test_value_to_bin_large_i64_range() {
    let mut m = blank_market();
    m.initialize(
        3,
        MARKET_TYPE_CONTINUOUS,
        Pubkey::default(),
        Pubkey::default(),
        Pubkey::default(),
        Pubkey::default(),
        TEST_DEADLINE,
        TEST_CREATED_AT,
        256,
        TEST_LIQUIDITY,
        i64::MIN / 2,
        i64::MAX / 2,
        255,
        254,
    )
    .unwrap();

    let bin = m.value_to_bin(0).unwrap();
    // 0 is slightly above the midpoint of [MIN/2, MAX/2] due to asymmetry.
    assert!(bin >= 127 && bin <= 128, "bin={bin} should be near 128");
}

// ── AMM Mutations ────────────────────────────────────────────────

#[test]
fn test_mint_complete_sets() {
    let mut m = blank_market();
    init_binary(&mut m);
    let h0 = m.reserves[0]; // 292_894
    m.mint_complete_sets(500_000).unwrap();
    assert_eq!(m.reserves, vec![h0 + 500_000; 2]);
    assert_eq!(m.total_minted, 1_500_000);
}

#[test]
fn test_burn_complete_sets() {
    let mut m = blank_market();
    init_binary(&mut m);
    let h0 = m.reserves[0]; // 292_894
    m.burn_complete_sets(200_000).unwrap();
    assert_eq!(m.reserves, vec![h0 - 200_000; 2]);
    assert_eq!(m.total_minted, 800_000);
}

#[test]
fn test_burn_complete_sets_underflow() {
    let mut m = blank_market();
    init_binary(&mut m);
    assert_eq!(
        m.burn_complete_sets(TEST_LIQUIDITY + 1).unwrap_err(),
        error!(DekantPmError::InsufficientLiquidity)
    );
}

#[test]
fn test_compute_lp_shares_for_deposit() {
    let mut m = blank_market();
    init_binary(&mut m);
    let shares = m.compute_lp_shares_for_deposit(500_000).unwrap();
    assert_eq!(shares, 500_000);
}

#[test]
fn test_compute_collateral_for_withdrawal() {
    let mut m = blank_market();
    init_binary(&mut m);
    let coll = m.compute_collateral_for_withdrawal(500_000).unwrap();
    assert_eq!(coll, 500_000);
}

#[test]
fn test_compute_collateral_rejects_excess_shares() {
    let mut m = blank_market();
    init_binary(&mut m);
    assert_eq!(
        m.compute_collateral_for_withdrawal(TEST_LIQUIDITY as u128 + 1)
            .unwrap_err(),
        error!(DekantPmError::InsufficientShares)
    );
}

// ── Implied Probability ──────────────────────────────────────────

#[test]
fn test_implied_probability_uniform() {
    let mut m = blank_market();
    init_binary(&mut m);
    let p0 = m.implied_probability(0).unwrap();
    let p1 = m.implied_probability(1).unwrap();
    // Approximately 500M each (not exact due to isqrt rounding in init).
    let diff0 = if p0 > 500_000_000 { p0 - 500_000_000 } else { 500_000_000 - p0 };
    let diff1 = if p1 > 500_000_000 { p1 - 500_000_000 } else { 500_000_000 - p1 };
    assert!(diff0 < 5_000, "p0={p0}");
    assert!(diff1 < 5_000, "p1={p1}");
    // Sum approximately SCALE.
    let sum = p0 + p1;
    let sum_diff = if sum > SCALE { sum - SCALE } else { SCALE - sum };
    assert!(sum_diff < 5_000, "sum={sum}");
}

#[test]
fn test_implied_probability_out_of_bounds() {
    let mut m = blank_market();
    init_binary(&mut m);
    assert_eq!(
        m.implied_probability(2).unwrap_err(),
        error!(DekantPmError::InvalidOutcome)
    );
}

// ── Space Calculation ────────────────────────────────────────────

#[test]
fn test_space_binary() {
    assert_eq!(Market::space(2), 311 + 2 * 16);
}

#[test]
fn test_space_multi_32() {
    assert_eq!(Market::space(32), 311 + 32 * 16);
}

#[test]
fn test_space_continuous_256() {
    assert_eq!(Market::space(256), 311 + 256 * 16);
}

// ── Enum Tests ───────────────────────────────────────────────────

#[test]
fn test_market_type_from_u8() {
    assert_eq!(MarketType::from_u8(0), Some(MarketType::Binary));
    assert_eq!(MarketType::from_u8(1), Some(MarketType::MultiOutcome));
    assert_eq!(MarketType::from_u8(2), Some(MarketType::Continuous));
    assert_eq!(MarketType::from_u8(3), None);
}

#[test]
fn test_market_type_valid_num_outcomes() {
    assert!(MarketType::Binary.valid_num_outcomes(2));
    assert!(!MarketType::Binary.valid_num_outcomes(3));

    assert!(MarketType::MultiOutcome.valid_num_outcomes(3));
    assert!(MarketType::MultiOutcome.valid_num_outcomes(32));
    assert!(!MarketType::MultiOutcome.valid_num_outcomes(2));
    assert!(!MarketType::MultiOutcome.valid_num_outcomes(33));

    assert!(MarketType::Continuous.valid_num_outcomes(2));
    assert!(MarketType::Continuous.valid_num_outcomes(256));
    assert!(!MarketType::Continuous.valid_num_outcomes(1));
    assert!(!MarketType::Continuous.valid_num_outcomes(257));
}

#[test]
fn test_market_state_helpers() {
    assert!(MarketState::Active.can_trade());
    assert!(!MarketState::Paused.can_trade());
    assert!(!MarketState::Resolved.can_trade());

    assert!(MarketState::PendingResolution.can_resolve());
    assert!(!MarketState::Active.can_resolve());

    assert!(MarketState::Resolved.is_terminal());
    assert!(!MarketState::Active.is_terminal());
}

#[test]
fn test_validate_reserves_integrity() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.validate_reserves_integrity().unwrap();

    m.num_outcomes = 5;
    assert_eq!(
        m.validate_reserves_integrity().unwrap_err(),
        error!(DekantPmError::InvalidNumOutcomes)
    );
}

#[test]
fn test_recompute_k_squared() {
    let mut m = blank_market();
    init_binary(&mut m);

    // recompute_k_squared now computes total_minted².
    m.total_minted = 2_000_000;
    m.recompute_k_squared().unwrap();
    assert_eq!(m.k_squared, (2_000_000u128).pow(2));
}

// ── Fee Computation Edge Cases ──────────────────────────────────

#[test]
fn test_compute_fees_lp_share_zero_all_to_protocol() {
    // lp_fee_share_bps = 0: LP gets nothing, protocol gets entire fee.
    let fb = Market::compute_fees(1_000_000, 100, 0).unwrap();
    assert_eq!(fb.total_fee, 10_000); // 100 bps = 1%
    assert_eq!(fb.lp_fee, 0);
    assert_eq!(fb.protocol_fee, 10_000);
    assert_eq!(fb.net_amount, 990_000);
}

#[test]
fn test_compute_fees_lp_share_10000_all_to_lp() {
    // lp_fee_share_bps = 10000: LP gets the entire fee.
    let fb = Market::compute_fees(1_000_000, 100, 10_000).unwrap();
    assert_eq!(fb.total_fee, 10_000);
    assert_eq!(fb.lp_fee, 10_000);
    assert_eq!(fb.protocol_fee, 0);
    assert_eq!(fb.net_amount, 990_000);
}

#[test]
fn test_compute_fees_rounding_behavior() {
    // Check that rounding is floored (favorable to trader).
    // 333 bps on 100 = 100 * 333 / 10000 = 3.33 → floor to 3.
    let fb = Market::compute_fees(100, 333, 5_000).unwrap();
    assert_eq!(fb.total_fee, 3);
    // lp_fee = 3 * 5000 / 10000 = 1.5 → floor to 1.
    assert_eq!(fb.lp_fee, 1);
    assert_eq!(fb.protocol_fee, 2); // total_fee - lp_fee = 3 - 1 = 2
    assert_eq!(fb.net_amount, 97);
}

#[test]
fn test_compute_fees_max_u64_gross() {
    // Should not overflow: u64::MAX * 5000 fits in u128.
    let fb = Market::compute_fees(u64::MAX, 5_000, 5_000).unwrap();
    assert_eq!(fb.total_fee as u128, (u64::MAX as u128) * 5_000 / 10_000);
    assert_eq!(
        fb.net_amount as u128,
        u64::MAX as u128 - (u64::MAX as u128) * 5_000 / 10_000
    );
}

// ── LP Share Computation Edge Cases ─────────────────────────────

#[test]
fn test_compute_lp_shares_first_deposit() {
    // When lp_shares_total == 0, first depositor gets shares == collateral.
    let mut m = blank_market();
    m.lp_shares_total = 0;
    m.total_minted = 0;
    let shares = m.compute_lp_shares_for_deposit(1_000_000).unwrap();
    assert_eq!(shares, 1_000_000);
}

#[test]
fn test_compute_lp_shares_proportional() {
    let mut m = blank_market();
    init_binary(&mut m);
    // After init: lp_shares_total = 1_000_000, total_minted = 1_000_000.
    // Deposit 500_000: shares = 1_000_000 * 500_000 / 1_000_000 = 500_000.
    let shares = m.compute_lp_shares_for_deposit(500_000).unwrap();
    assert_eq!(shares, 500_000);
}

#[test]
fn test_compute_lp_shares_after_total_minted_growth() {
    let mut m = blank_market();
    init_binary(&mut m);
    // Simulate total_minted growing (e.g. from trading complete sets).
    m.total_minted = 2_000_000;
    // lp_shares_total still 1_000_000.
    // New deposit of 1_000_000: shares = 1_000_000 * 1_000_000 / 2_000_000 = 500_000.
    let shares = m.compute_lp_shares_for_deposit(1_000_000).unwrap();
    assert_eq!(shares, 500_000);
}

// ── compute_lp_fee_share edge cases ─────────────────────────────

#[test]
fn test_compute_lp_fee_share_zero_accumulated() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.lp_fee_accumulated = 0;
    let fee_share = m.compute_lp_fee_share(500_000).unwrap();
    assert_eq!(fee_share, 0);
}

#[test]
fn test_compute_lp_fee_share_with_accumulated_fees() {
    let mut m = blank_market();
    init_binary(&mut m);
    // Simulate accumulated LP fees.
    m.lp_fee_accumulated = 10_000;
    // Total shares = 1_000_000. Withdrawing 500_000 shares = 50%.
    let fee_share = m.compute_lp_fee_share(500_000).unwrap();
    assert_eq!(fee_share, 5_000); // 50% of 10_000
}

#[test]
fn test_compute_lp_fee_share_all_shares() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.lp_fee_accumulated = 7_777;
    // Withdraw all shares: should get all accumulated fees.
    let fee_share = m.compute_lp_fee_share(m.lp_shares_total).unwrap();
    assert_eq!(fee_share, 7_777);
}

#[test]
fn test_compute_lp_fee_share_rounding() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.lp_fee_accumulated = 10;
    // shares = 333_333, total = 1_000_000.
    // fee = 10 * 333_333 / 1_000_000 = 3.33333 → floor to 3.
    let fee_share = m.compute_lp_fee_share(333_333).unwrap();
    assert_eq!(fee_share, 3);
}

// ── compute_collateral_for_withdrawal edge cases ────────────────

#[test]
fn test_compute_collateral_withdrawal_full() {
    let mut m = blank_market();
    init_binary(&mut m);
    let coll = m
        .compute_collateral_for_withdrawal(m.lp_shares_total)
        .unwrap();
    assert_eq!(coll, m.total_minted);
}

#[test]
fn test_compute_collateral_withdrawal_zero_shares() {
    let mut m = blank_market();
    init_binary(&mut m);
    let coll = m.compute_collateral_for_withdrawal(0).unwrap();
    assert_eq!(coll, 0);
}

// ── accrue_fees edge cases ──────────────────────────────────────

#[test]
fn test_accrue_fees_multiple_rounds() {
    let mut m = blank_market();
    init_binary(&mut m);
    for _ in 0..100 {
        let fb = FeeBreakdown {
            total_fee: 100,
            lp_fee: 60,
            protocol_fee: 40,
            net_amount: 9_900,
        };
        m.accrue_fees(&fb).unwrap();
    }
    assert_eq!(m.lp_fee_accumulated, 6_000);
    assert_eq!(m.protocol_fee_accumulated, 4_000);
}

// ── State transition edge cases ─────────────────────────────────

#[test]
fn test_transition_to_pending_from_paused() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.pause().unwrap();
    m.transition_to_pending().unwrap();
    assert!(m.is_pending_resolution());
}

#[test]
fn test_transition_to_pending_from_resolved_fails() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.transition_to_pending().unwrap();
    m.resolve(0, 0, TEST_DEADLINE + 1).unwrap();
    assert_eq!(
        m.transition_to_pending().unwrap_err(),
        error!(DekantPmError::MarketAlreadyResolved)
    );
}

#[test]
fn test_unpause_non_paused_fails() {
    let mut m = blank_market();
    init_binary(&mut m);
    assert_eq!(
        m.unpause(TEST_CREATED_AT + 1).unwrap_err(),
        error!(DekantPmError::MarketNotPaused)
    );
}

// ── implied_probability edge cases ──────────────────────────────

#[test]
fn test_implied_probability_total_minted_zero() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.reserves = vec![0, 0];
    m.total_minted = 0;
    // total_minted² = 0, division by zero should be caught.
    assert_eq!(
        m.implied_probability(0).unwrap_err(),
        error!(DekantPmError::DivisionByZero)
    );
}

#[test]
fn test_implied_probability_skewed() {
    let mut m = blank_market();
    init_binary(&mut m);
    // tm=500K, h=[200K, 100K], x=[300K, 400K], sum_x=700K (linear display).
    m.total_minted = 500_000;
    m.reserves = vec![200_000, 100_000];
    m.recompute_k_squared().unwrap();
    let p0 = m.implied_probability(0).unwrap();
    let p1 = m.implied_probability(1).unwrap();
    // p0 = 300K/700K * SCALE = 428_571_428, p1 = 400K/700K * SCALE = 571_428_571
    // Lower reserve → bigger position → higher probability.
    assert!(p0 < p1, "p0={p0}, p1={p1}");
    assert_eq!(p0, 428_571_428);
    assert_eq!(p1, 571_428_571);
    // Sum is SCALE minus per-term flooring (≤ n-1 = 1).
    assert!(SCALE - (p0 + p1) <= 1, "sum={}", p0 + p1);
}

// ── mint/burn complete sets edge cases ───────────────────────────

#[test]
fn test_mint_complete_sets_overflow() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.reserves = vec![u64::MAX - 1, u64::MAX - 1];
    assert_eq!(
        m.mint_complete_sets(2).unwrap_err(),
        error!(DekantPmError::MathOverflow)
    );
}

#[test]
fn test_burn_complete_sets_exact() {
    let mut m = blank_market();
    init_binary(&mut m);
    // Burn exactly the reserve amount (max burnable per bin).
    let h0 = m.reserves[0]; // 292_894
    m.burn_complete_sets(h0).unwrap();
    assert_eq!(m.reserves, vec![0, 0]);
    assert_eq!(m.total_minted, TEST_LIQUIDITY as u128 - h0 as u128);
}

// ── Multi-outcome market init ───────────────────────────────────

#[test]
fn test_initialize_multi_outcome() {
    let mut m = blank_market();
    m.initialize(
        1,
        MARKET_TYPE_MULTI,
        Pubkey::default(),
        Pubkey::default(),
        Pubkey::default(),
        Pubkey::default(),
        TEST_DEADLINE,
        TEST_CREATED_AT,
        5,
        TEST_LIQUIDITY,
        0,
        0,
        255,
        254,
    )
    .unwrap();
    assert_eq!(m.market_type, MARKET_TYPE_MULTI);
    assert_eq!(m.num_outcomes, 5);
    assert_eq!(m.reserves.len(), 5);
    assert_eq!(m.k_squared, (TEST_LIQUIDITY as u128).pow(2));
}

// ── value_to_bin edge cases ─────────────────────────────────────

#[test]
fn test_value_to_bin_below_range_min() {
    let mut m = blank_market();
    init_continuous(&mut m, 10);
    // Value below range_min should map to bin 0.
    assert_eq!(m.value_to_bin(-100).unwrap(), 0);
}

#[test]
fn test_value_to_bin_above_range_max() {
    let mut m = blank_market();
    init_continuous(&mut m, 10);
    // Value above range_max should map to last bin.
    assert_eq!(m.value_to_bin(2_000_000_000).unwrap(), 9);
}

#[test]
fn test_value_to_bin_exact_boundaries() {
    let mut m = blank_market();
    init_continuous(&mut m, 4);
    // range [0, 1_000_000_000], 4 bins, each bin = 250_000_000 wide.
    // Value at 250_000_000 should map to bin 1.
    assert_eq!(m.value_to_bin(250_000_000).unwrap(), 1);
    // Value at 749_999_999 should map to bin 2.
    assert_eq!(m.value_to_bin(749_999_999).unwrap(), 2);
}

// ── is_expired ──────────────────────────────────────────────────

#[test]
fn test_is_expired_before_deadline() {
    let mut m = blank_market();
    init_binary(&mut m);
    assert!(!m.is_expired(TEST_DEADLINE - 1));
}

#[test]
fn test_is_expired_at_deadline() {
    let mut m = blank_market();
    init_binary(&mut m);
    assert!(m.is_expired(TEST_DEADLINE));
}

#[test]
fn test_is_expired_after_deadline() {
    let mut m = blank_market();
    init_binary(&mut m);
    assert!(m.is_expired(TEST_DEADLINE + 1));
}

// ── require_resolved ────────────────────────────────────────────

#[test]
fn test_require_resolved_on_active() {
    let mut m = blank_market();
    init_binary(&mut m);
    assert_eq!(
        m.require_resolved().unwrap_err(),
        error!(DekantPmError::MarketNotResolved)
    );
}

#[test]
fn test_require_resolved_on_resolved() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.transition_to_pending().unwrap();
    m.resolve(0, 0, TEST_DEADLINE + 1).unwrap();
    m.require_resolved().unwrap();
}

// ── Fee accumulation overflow boundaries ────────────────────

#[test]
fn test_accrue_fees_protocol_fee_overflow() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.protocol_fee_accumulated = u64::MAX;
    let fb = FeeBreakdown {
        total_fee: 2,
        lp_fee: 1,
        protocol_fee: 1,
        net_amount: 998,
    };
    assert_eq!(
        m.accrue_fees(&fb).unwrap_err(),
        error!(DekantPmError::MathOverflow)
    );
}

#[test]
fn test_accrue_fees_lp_fee_overflow() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.lp_fee_accumulated = u128::MAX;
    let fb = FeeBreakdown {
        total_fee: 2,
        lp_fee: 1,
        protocol_fee: 1,
        net_amount: 998,
    };
    assert_eq!(
        m.accrue_fees(&fb).unwrap_err(),
        error!(DekantPmError::MathOverflow)
    );
}

// ── LP share dilution ───────────────────────────────────────

#[test]
fn test_lp_shares_diluted_by_total_minted_growth() {
    let mut m = blank_market();
    init_binary(&mut m);
    // Initial: lp_shares_total = 1M, total_minted = 1M.
    // Simulate trading that increases total_minted (complete sets minted).
    m.total_minted = 5_000_000;
    // New LP deposits 1_000_000 collateral.
    // shares = 1_000_000 * 1_000_000 / 5_000_000 = 200_000.
    let shares = m.compute_lp_shares_for_deposit(1_000_000).unwrap();
    assert_eq!(shares, 200_000);
    // The new LP gets only 200k shares vs the initial LP's 1M shares,
    // even though they deposited the same amount — this is dilution.
}

// ── Deadline boundary tests ─────────────────────────────────

#[test]
fn test_is_expired_one_tick_before() {
    let mut m = blank_market();
    init_binary(&mut m);
    assert!(!m.is_expired(TEST_DEADLINE - 1));
    // Trading should still be allowed.
    m.require_trading_allowed(TEST_DEADLINE - 1).unwrap();
}

#[test]
fn test_require_trading_exactly_at_deadline() {
    let mut m = blank_market();
    init_binary(&mut m);
    // At deadline, trading should be rejected.
    assert_eq!(
        m.require_trading_allowed(TEST_DEADLINE).unwrap_err(),
        error!(DekantPmError::MarketClosed)
    );
}

// ── compute_collateral_for_withdrawal rounding ──────────────

#[test]
fn test_compute_collateral_withdrawal_rounding() {
    let mut m = blank_market();
    init_binary(&mut m);
    // Simulate odd total_minted and shares that don't divide evenly.
    m.total_minted = 1_000_001;
    m.lp_shares_total = 3;
    // collateral = 1_000_001 * 1 / 3 = 333_333.666... → floor to 333_333.
    let coll = m.compute_collateral_for_withdrawal(1).unwrap();
    assert_eq!(coll, 333_333);
}

#[test]
fn test_compute_collateral_withdrawal_full_odd() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.total_minted = 999_999;
    m.lp_shares_total = 999_999;
    let coll = m.compute_collateral_for_withdrawal(999_999).unwrap();
    assert_eq!(coll, 999_999);
}

// ── value_to_bin all-bins coverage ──────────────────────────

#[test]
fn test_value_to_bin_all_bins_reachable() {
    let mut m = blank_market();
    init_continuous(&mut m, 10);
    // Range [0, 1B], 10 bins, each 100M wide.
    // Check that values in each bin map correctly.
    let expected_bins: Vec<(i64, u16)> = vec![
        (50_000_000, 0),
        (150_000_000, 1),
        (250_000_000, 2),
        (350_000_000, 3),
        (450_000_000, 4),
        (550_000_000, 5),
        (650_000_000, 6),
        (750_000_000, 7),
        (850_000_000, 8),
        (950_000_000, 9),
    ];
    for (val, expected_bin) in expected_bins {
        let bin = m.value_to_bin(val).unwrap();
        assert_eq!(
            bin, expected_bin,
            "value_to_bin({val}) = {bin}, expected {expected_bin}"
        );
    }
}

// ── Exhaustive invalid state transitions ────────────────────

#[test]
fn test_resolve_from_active_fails() {
    let mut m = blank_market();
    init_binary(&mut m);
    assert_eq!(
        m.resolve(0, 0, TEST_DEADLINE + 1).unwrap_err(),
        error!(DekantPmError::MarketNotPendingResolution)
    );
}

#[test]
fn test_resolve_from_paused_fails() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.pause().unwrap();
    assert_eq!(
        m.resolve(0, 0, TEST_DEADLINE + 1).unwrap_err(),
        error!(DekantPmError::MarketNotPendingResolution)
    );
}

#[test]
fn test_pause_from_pending_fails() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.transition_to_pending().unwrap();
    assert_eq!(
        m.pause().unwrap_err(),
        error!(DekantPmError::MarketNotActive)
    );
}

#[test]
fn test_pause_from_resolved_fails() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.transition_to_pending().unwrap();
    m.resolve(0, 0, TEST_DEADLINE + 1).unwrap();
    assert_eq!(
        m.pause().unwrap_err(),
        error!(DekantPmError::MarketNotActive)
    );
}

#[test]
fn test_unpause_from_pending_fails() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.transition_to_pending().unwrap();
    assert_eq!(
        m.unpause(TEST_CREATED_AT + 1).unwrap_err(),
        error!(DekantPmError::MarketNotPaused)
    );
}

#[test]
fn test_unpause_from_resolved_fails() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.transition_to_pending().unwrap();
    m.resolve(0, 0, TEST_DEADLINE + 1).unwrap();
    assert_eq!(
        m.unpause(TEST_CREATED_AT + 1).unwrap_err(),
        error!(DekantPmError::MarketNotPaused)
    );
}

#[test]
fn test_double_resolve_fails() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.transition_to_pending().unwrap();
    m.resolve(0, 0, TEST_DEADLINE + 1).unwrap();
    assert_eq!(
        m.resolve(1, 0, TEST_DEADLINE + 2).unwrap_err(),
        error!(DekantPmError::MarketNotPendingResolution)
    );
}

#[test]
fn test_transition_to_pending_from_pending_fails() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.transition_to_pending().unwrap();
    // Already in PendingResolution, can't transition again.
    assert_eq!(
        m.transition_to_pending().unwrap_err(),
        error!(DekantPmError::MarketAlreadyResolved)
    );
}

// ── validate_outcome edge cases ─────────────────────────────

#[test]
fn test_validate_outcome_boundary() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.validate_outcome(0).unwrap();
    m.validate_outcome(1).unwrap();
    assert_eq!(
        m.validate_outcome(2).unwrap_err(),
        error!(DekantPmError::InvalidOutcome)
    );
}

#[test]
fn test_validate_outcome_max_u16() {
    let mut m = blank_market();
    init_binary(&mut m);
    assert_eq!(
        m.validate_outcome(u16::MAX).unwrap_err(),
        error!(DekantPmError::InvalidOutcome)
    );
}

// ── compute_lp_resolved_payout tests ────────────────────────────────

#[test]
fn test_compute_lp_resolved_payout_proportional() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.state = STATE_RESOLVED;
    m.resolved_outcome = 0;
    m.reserves = vec![300_000, 500_000];
    m.lp_shares_total = 1_000_000;

    // LP with 500_000 shares out of 1_000_000 total
    let payout = m.compute_lp_resolved_payout(500_000).unwrap();
    // Expected: 300_000 * 500_000 / 1_000_000 = 150_000
    assert_eq!(payout, 150_000);
}

#[test]
fn test_compute_lp_resolved_payout_full_shares() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.state = STATE_RESOLVED;
    m.resolved_outcome = 0;
    m.reserves = vec![300_000, 500_000];
    m.lp_shares_total = 1_000_000;

    let payout = m.compute_lp_resolved_payout(1_000_000).unwrap();
    assert_eq!(payout, 300_000);
}

#[test]
fn test_compute_lp_resolved_payout_zero_reserves() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.state = STATE_RESOLVED;
    m.resolved_outcome = 0;
    m.reserves = vec![0, 500_000];
    m.lp_shares_total = 1_000_000;

    let payout = m.compute_lp_resolved_payout(500_000).unwrap();
    assert_eq!(payout, 0);
}

#[test]
fn test_compute_lp_resolved_payout_rejects_excess_shares() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.state = STATE_RESOLVED;
    m.resolved_outcome = 0;
    m.reserves = vec![300_000, 500_000];
    m.lp_shares_total = 1_000_000;

    let result = m.compute_lp_resolved_payout(1_000_001);
    assert!(result.is_err());
}

// ── implied_probability extreme values ──────────────────────────────

#[test]
fn test_implied_probability_one_outcome_at_100_percent() {
    // When one outcome has reserve = 0, its position = total_minted,
    // so its probability = total_minted² * SCALE / total_minted² = SCALE (100%).
    let mut m = blank_market();
    init_binary(&mut m);
    m.reserves = vec![0, m.total_minted as u64];
    // outcome 0: x = total_minted - 0 = total_minted, prob = SCALE
    let p0 = m.implied_probability(0).unwrap();
    assert_eq!(p0, SCALE);
    // outcome 1: x = total_minted - total_minted = 0, prob = 0
    let p1 = m.implied_probability(1).unwrap();
    assert_eq!(p1, 0);
}

#[test]
fn test_implied_probability_large_total_minted() {
    // Test with large total_minted to verify no overflow in the computation.
    // x² * SCALE must fit u128. Max x ≈ total_minted, so total_minted² * SCALE < u128::MAX.
    // u128::MAX / SCALE ≈ 3.4e29, sqrt ≈ 1.84e14.
    let mut m = blank_market();
    init_binary(&mut m);
    m.total_minted = 100_000_000_000_000; // 10^14 (safely under 1.84e14 limit)
    let x_per = dekant_pm::engine::sqrt::isqrt(
        m.total_minted * m.total_minted / 2,
    );
    let reserve = (m.total_minted - x_per) as u64;
    m.reserves = vec![reserve; 2];

    let p0 = m.implied_probability(0).unwrap();
    let p1 = m.implied_probability(1).unwrap();
    // Both should be approximately 500M (50%).
    let diff0 = p0.abs_diff(500_000_000);
    let diff1 = p1.abs_diff(500_000_000);
    assert!(diff0 < 5_000, "p0={p0}, diff={diff0}");
    assert!(diff1 < 5_000, "p1={p1}, diff={diff1}");
}
