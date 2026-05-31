use anchor_lang::prelude::*;
use dekant_pm::state::market::{Market, FeeBreakdown, MarketType, MarketState};
use dekant_pm::constants::*;
use dekant_pm::engine::kernel::{compute_kernel_payout, compute_scaling_factor};
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
        kernel_width: 0,
        scaling_factor: 0,
        _padding: [0u8; 20],
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
        0,   // kernel_width — always 0 for binary
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
        0,             // kernel_width — default 0 (WTA) for existing tests
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
            TEST_DEADLINE, TEST_CREATED_AT, 2, TEST_LIQUIDITY, 0, 0, 0, 255, 254,
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
            TEST_DEADLINE, TEST_CREATED_AT, 3, TEST_LIQUIDITY, 0, 0, 0, 255, 254,
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
            TEST_DEADLINE, TEST_CREATED_AT, 2, 999, 0, 0, 0, 255, 254,
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
            TEST_CREATED_AT, TEST_CREATED_AT, 2, TEST_LIQUIDITY, 0, 0, 0, 255, 254,
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
            TEST_DEADLINE, TEST_CREATED_AT, 10, TEST_LIQUIDITY, 100, 50, 0, 255, 254,
        )
        .unwrap_err();
    assert_eq!(err, error!(DekantPmError::InvalidRange));
}

/// P2-2a: continuous market — kernel_width must be strictly less than num_outcomes.
/// Equal to or greater than num_outcomes means every bin gets a non-zero kernel
/// weight, which would always trigger solvency scaling regardless of trader positions.
#[test]
fn test_initialize_continuous_rejects_kernel_width_ge_num_outcomes() {
    let mut m = blank_market();
    let err = m
        .initialize(
            1, MARKET_TYPE_CONTINUOUS, Pubkey::default(), Pubkey::default(),
            Pubkey::default(), Pubkey::default(),
            TEST_DEADLINE, TEST_CREATED_AT, 10, TEST_LIQUIDITY, 0, 1_000_000_000,
            10,  // kernel_width == num_outcomes
            255, 254,
        )
        .unwrap_err();
    assert_eq!(err, error!(DekantPmError::InvalidKernelWidth));

    let mut m2 = blank_market();
    let err2 = m2
        .initialize(
            1, MARKET_TYPE_CONTINUOUS, Pubkey::default(), Pubkey::default(),
            Pubkey::default(), Pubkey::default(),
            TEST_DEADLINE, TEST_CREATED_AT, 10, TEST_LIQUIDITY, 0, 1_000_000_000,
            42,  // kernel_width > num_outcomes
            255, 254,
        )
        .unwrap_err();
    assert_eq!(err2, error!(DekantPmError::InvalidKernelWidth));
}

/// P2-2a: continuous market with a sane kernel_width (e.g. recommended W=3 on
/// a 16-bin market) initializes successfully and stores the value.
#[test]
fn test_initialize_continuous_accepts_valid_kernel_width() {
    let mut m = blank_market();
    m.initialize(
        1, MARKET_TYPE_CONTINUOUS, Pubkey::default(), Pubkey::default(),
        Pubkey::default(), Pubkey::default(),
        TEST_DEADLINE, TEST_CREATED_AT, 16, TEST_LIQUIDITY, 0, 1_000_000_000,
        3,   // recommended starting kernel_width
        255, 254,
    )
    .unwrap();
    assert_eq!(m.kernel_width, 3);
    assert_eq!(m.scaling_factor, 0, "scaling_factor stays 0 until resolution");
    assert_eq!(m.version, SCHEMA_VERSION, "new markets carry schema v2");
}

/// P2-2a: binary/multi markets must always be WTA (kernel_width == 0).
/// `initialize()` defends against non-zero kernel_width passed for discrete
/// markets — the create_market handler also force-zeros it, this is belt-and-suspenders.
#[test]
fn test_initialize_binary_rejects_nonzero_kernel_width() {
    let mut m = blank_market();
    let err = m
        .initialize(
            1, MARKET_TYPE_BINARY, Pubkey::default(), Pubkey::default(),
            Pubkey::default(), Pubkey::default(),
            TEST_DEADLINE, TEST_CREATED_AT, 2, TEST_LIQUIDITY, 0, 0,
            1,   // non-zero kernel_width on a binary market
            255, 254,
        )
        .unwrap_err();
    assert_eq!(err, error!(DekantPmError::InvalidKernelWidth));
}

#[test]
fn test_initialize_multi_rejects_nonzero_kernel_width() {
    let mut m = blank_market();
    let err = m
        .initialize(
            1, MARKET_TYPE_MULTI, Pubkey::default(), Pubkey::default(),
            Pubkey::default(), Pubkey::default(),
            TEST_DEADLINE, TEST_CREATED_AT, 5, TEST_LIQUIDITY, 0, 0,
            1,
            255, 254,
        )
        .unwrap_err();
    assert_eq!(err, error!(DekantPmError::InvalidKernelWidth));
}

// ── Borsh Layout / Backward Compatibility ────────────────────────

/// P2-1a: The new `kernel_width: u16 + scaling_factor: u64 + _padding: [u8; 20]`
/// layout consumes exactly the same 30 bytes as the old single `_padding: [u8; 30]`.
/// Serialized size must equal `Market::space(n) - 8` (anchor discriminator excluded
/// from the borsh payload).
#[test]
fn test_borsh_layout_size_matches_space_calculation() {
    let mut m = blank_market();
    init_binary(&mut m);
    let bytes = m.try_to_vec().unwrap();
    assert_eq!(bytes.len(), Market::space(2) - 8);

    let mut m10 = blank_market();
    init_continuous(&mut m10, 10);
    let bytes10 = m10.try_to_vec().unwrap();
    assert_eq!(bytes10.len(), Market::space(10) - 8);
}

/// P2-1a: When `kernel_width=0`, `scaling_factor=0`, `_padding=[0;20]`, the 30-byte
/// tail region between `vault_authority_bump` and the trailing `reserves`/
/// `trader_token_totals` Vecs is byte-for-byte identical to the old `_padding=[0;30]`.
/// This is the all-zeros invariant that makes existing on-chain accounts
/// deserialize unchanged under the new layout.
#[test]
fn test_borsh_zero_padding_region_all_zero_after_init() {
    let mut m = blank_market();
    init_binary(&mut m);
    let bytes = m.try_to_vec().unwrap();

    // Trailing Vec<u64> serializations: each is `4 (len prefix) + 8*n (data)`.
    let n = m.num_outcomes as usize;
    let trailing_vecs_len = (4 + 8 * n) * 2;
    let tail_end = bytes.len() - trailing_vecs_len;
    let tail_start = tail_end - 30; // 2 (kernel_width) + 8 (scaling_factor) + 20 (_padding)

    assert!(
        bytes[tail_start..tail_end].iter().all(|&b| b == 0),
        "kernel_width + scaling_factor + _padding region must be all zeros at init"
    );
}

/// P2-1b: An account created under the OLD layout (`_padding: [u8; 30]`, all zeros)
/// must deserialize correctly under the NEW layout — yielding `kernel_width=0`,
/// `scaling_factor=0`, `_padding=[0; 20]`. We simulate the old account by
/// explicitly zeroing the 30-byte tail region (matching the on-chain bytes of any
/// existing account) and then deserializing.
#[test]
fn test_borsh_old_layout_account_deserializes_with_zero_kernel() {
    let mut m = blank_market();
    init_binary(&mut m);
    let mut bytes = m.try_to_vec().unwrap();

    // Force the 30-byte tail to zero — this is the exact byte pattern any
    // pre-P2-1 account presents on-chain.
    let n = m.num_outcomes as usize;
    let trailing_vecs_len = (4 + 8 * n) * 2;
    let tail_end = bytes.len() - trailing_vecs_len;
    let tail_start = tail_end - 30;
    for b in &mut bytes[tail_start..tail_end] {
        *b = 0;
    }

    let restored = Market::try_from_slice(&bytes).unwrap();

    // New fields read back as zeros under the new layout.
    assert_eq!(restored.kernel_width, 0, "old-layout account must read kernel_width as 0");
    assert_eq!(restored.scaling_factor, 0, "old-layout account must read scaling_factor as 0");
    assert_eq!(restored._padding, [0u8; 20]);

    // Surrounding fields survived round-trip — confirms field offsets did not shift.
    assert_eq!(restored.market_id, m.market_id);
    assert_eq!(restored.market_type, m.market_type);
    assert_eq!(restored.num_outcomes, m.num_outcomes);
    assert_eq!(restored.k_squared, m.k_squared);
    assert_eq!(restored.total_minted, m.total_minted);
    assert_eq!(restored.bump, m.bump);
    assert_eq!(restored.vault_authority_bump, m.vault_authority_bump);
    assert_eq!(restored.reserves, m.reserves);
    assert_eq!(restored.trader_token_totals, m.trader_token_totals);
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
        0,
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

// ── P5-1: resolve() — kernel branch coverage ────────────────────
//
// Coverage philosophy (per IMPROVED_SMS_REFACTOR_TASKS.md §P5-1):
// the existing WTA tests above (`test_resolve_binary`, `test_resolve_continuous`,
// the trader-totals zero-padding cases) stay intact and are now interpreted as
// the `kernel_width == 0` regression suite — the contract for legacy/migrated
// markets. The block below adds the `kernel_width > 0` half of the matrix.
//
// All tests build a market via `init_continuous_kernel`, then write
// `trader_token_totals` directly. That bypasses the buy/sell handlers (which
// gate on STATE_ACTIVE) — exactly what we want for an isolated resolve unit
// test: the trader fixture is fully under the test's control, no instruction
// roundtrip in scope.

fn init_continuous_kernel(m: &mut Market, num_bins: u16, kernel_width: u16) {
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
        1_000_000_000,
        kernel_width,
        255,
        254,
    )
    .unwrap();
}

/// Map a target bin to the midpoint value the on-chain `value_to_bin`
/// will round back to that bin, then call `resolve()`.
fn resolve_at_bin(m: &mut Market, bin: u16) {
    let n = m.num_outcomes as i64;
    let span = m.range_max - m.range_min;
    let bin_w = span / n;
    let val = m.range_min + (bin as i64) * bin_w + bin_w / 2;
    m.transition_to_pending().unwrap();
    m.resolve(0, val, TEST_DEADLINE + 100).unwrap();
}

/// Concentrated trader fixture centred on the winning bin — chosen so the
/// kernel sweep test produces a strictly-decreasing scaling factor across
/// widths 1..=6 (raw claims grow as the kernel grabs more weight from the
/// shoulders). Returns the seven-bin trader_token_totals slice.
fn concentrated_fixture_at_8(num_bins: u16) -> Vec<u64> {
    let mut tt = vec![0u64; num_bins as usize];
    tt[5] = 800;
    tt[6] = 1_000;
    tt[7] = 1_200;
    tt[8] = 1_500;
    tt[9] = 1_200;
    tt[10] = 1_000;
    tt[11] = 800;
    tt
}

/// P5-1 test 1: `resolve()` on a continuous market with `kernel_width = 0`
/// must take the WTA branch — `scaling_factor` stays 0, `reserves[win]`
/// equals `total_minted - trader_token_totals[win]`. This is the contract
/// that lets legacy/migrated accounts (whose `kernel_width` deserializes
/// from zero padding) resolve identically to pre-refactor behavior.
#[test]
fn test_resolve_continuous_zero_width_takes_wta_branch() {
    let mut m = blank_market();
    init_continuous_kernel(&mut m, 16, 0);
    m.total_minted = 10_000;
    m.trader_token_totals = vec![0u64; 16];
    m.trader_token_totals[8] = 3_000;

    resolve_at_bin(&mut m, 8);

    assert_eq!(m.scaling_factor, 0, "WTA branch must leave scaling_factor untouched");
    assert_eq!(m.reserves[8] as u128, 10_000 - 3_000);
}

/// P5-1 test 2: width sweep `{1..=6}` against the same trader fixture,
/// winner pinned at `num_bins / 2 = 8` so the kernel is never truncated.
/// Asserts the three properties the spec requires per width:
///   (a) `scaling_factor` is non-increasing as w grows (concentrated
///       fixture makes it strictly-decreasing here)
///   (b) aggregate payout matches `compute_kernel_payout(tt, win, w, sf)`
///       — same arithmetic the engine uses, so a mismatch would mean
///       `resolve()` and the claim path computed different scaling factors
///   (c) exact solvency: `aggregate_payout + reserves[win] == total_minted`
#[test]
fn test_resolve_continuous_kernel_width_sweep_centered_winner() {
    let num_bins = 16u16;
    let win = (num_bins / 2) as usize;
    let total_minted: u128 = 2_500;
    let mut last_sf: u64 = u64::MAX;

    for w in 1u16..=6 {
        let mut m = blank_market();
        init_continuous_kernel(&mut m, num_bins, w);
        m.total_minted = total_minted;
        m.trader_token_totals = concentrated_fixture_at_8(num_bins);

        // Snapshot expected scaling factor BEFORE resolve, so a difference
        // attributes cleanly to resolve() rather than to the engine itself.
        let (expected_sf, _) = compute_scaling_factor(
            &m.trader_token_totals,
            win,
            w,
            total_minted,
        )
        .unwrap();
        let expected_aggregate = compute_kernel_payout(
            &m.trader_token_totals,
            win,
            w,
            expected_sf,
        )
        .unwrap();

        resolve_at_bin(&mut m, win as u16);

        // (b) resolve stored the engine's scaling factor verbatim.
        assert_eq!(
            m.scaling_factor, expected_sf,
            "scaling_factor mismatch at w={w}: resolve={}, engine={expected_sf}",
            m.scaling_factor,
        );

        // (a) Non-increasing across the sweep — concentrated fixture means
        // strictly decreasing, but the spec allows flat (uniform fixtures
        // would). Strictly-increasing is the only outright failure mode.
        assert!(
            m.scaling_factor <= last_sf,
            "scaling_factor must be non-increasing across widths: w={w} \
             current={} previous={last_sf}",
            m.scaling_factor,
        );
        last_sf = m.scaling_factor;

        // (c) Exact solvency: aggregate payout + LP residual == total_minted.
        let residual = m.reserves[win] as u128;
        assert_eq!(
            expected_aggregate + residual,
            total_minted,
            "solvency violated at w={w}: agg={expected_aggregate} \
             residual={residual} tm={total_minted}",
        );
    }

    // Sanity floor: the concentrated fixture should have actually triggered
    // scaling (sf < SCALE) for at least the widest kernel, or the test isn't
    // exercising the dilution path it claims to test.
    assert!(
        last_sf < SCALE as u64,
        "fixture under-concentrated — w=6 sf={last_sf} stayed at SCALE; \
         pick a smaller total_minted or a tighter fixture",
    );
}

/// P5-1 test 3: a kernel-mode market with **no traders** must resolve to
/// `scaling_factor = SCALE` (no dilution path entered) and
/// `reserves[win] = total_minted` (LP keeps the whole pool). Matches the
/// `compute_scaling_factor` zero-claims short-circuit at engine.rs:76.
#[test]
fn test_resolve_continuous_kernel_no_traders_lp_keeps_all() {
    let mut m = blank_market();
    init_continuous_kernel(&mut m, 16, 3);
    m.total_minted = 1_000_000;
    m.trader_token_totals = vec![0u64; 16];

    resolve_at_bin(&mut m, 8);

    assert_eq!(m.scaling_factor, SCALE as u64);
    assert_eq!(m.reserves[8] as u128, 1_000_000);
}

/// P5-1 test 4: heavy concentration at the winning bin pushes raw kernel
/// claims well past `total_minted`, so the scaling cap must engage
/// (`scaling_factor < SCALE`) and `reserves[win]` must collapse to zero
/// (or near-zero, modulo per-bin flooring — see the bound below).
#[test]
fn test_resolve_continuous_kernel_heavy_concentration_triggers_scaling() {
    let mut m = blank_market();
    init_continuous_kernel(&mut m, 16, 4);
    m.total_minted = 1_000_000;
    m.trader_token_totals = vec![0u64; 16];
    m.trader_token_totals[8] = 10_000_000; // 10× the vault

    resolve_at_bin(&mut m, 8);

    // sf = floor(total_minted * SCALE / raw) = floor(1M * SCALE / 10M) = SCALE/10
    let expected_sf = (SCALE / 10) as u64;
    assert_eq!(m.scaling_factor, expected_sf);

    // LP residual after dilution is the floor leftover only. With a single
    // bin contributing (no per-bin floor cascade), the leftover is at most
    // 1 lamport — comfortably below `num_bins = 16`.
    let residual = m.reserves[8] as u128;
    assert!(
        residual < 16,
        "residual={residual} too large; scaling-factor cap should have absorbed the surplus"
    );
}

/// P5-1 test 5: a binary market always has `kernel_width = 0` (init
/// enforces it). Verify the kernel-aware refactor of `resolve()` left the
/// binary path untouched: `scaling_factor` stays 0 (the WTA branch never
/// even calls into the kernel engine), and `reserves[win]` is the WTA
/// residual (`total_minted - trader_token_totals[win]`).
#[test]
fn test_resolve_binary_kernel_refactor_does_not_disturb_wta_path() {
    let mut m = blank_market();
    init_binary(&mut m);
    m.total_minted = 1_000_000;
    m.trader_token_totals = vec![0u64; 2];
    m.trader_token_totals[1] = 250_000;

    m.transition_to_pending().unwrap();
    m.resolve(1, 0, TEST_DEADLINE + 100).unwrap();

    assert_eq!(m.scaling_factor, 0, "binary resolve must never touch scaling_factor");
    assert_eq!(m.reserves[1] as u128, 1_000_000 - 250_000);
    assert_eq!(m.kernel_width, 0, "binary init must force kernel_width to 0");
}

/// P5-1 test 6a: winner at bin 0 — kernel only extends rightward (no
/// underflow possible because `kernel_weight` is keyed off `i.abs_diff(win)`
/// and `i` is unsigned). Verify exact solvency with truncated support.
#[test]
fn test_resolve_continuous_kernel_left_boundary_winner() {
    let num_bins = 16u16;
    let w = 3u16;
    let win = 0usize;

    let mut m = blank_market();
    init_continuous_kernel(&mut m, num_bins, w);
    m.total_minted = 5_000;
    m.trader_token_totals = vec![0u64; num_bins as usize];
    m.trader_token_totals[0] = 1_000; // weight 1.0
    m.trader_token_totals[1] = 800;   // weight 3/4
    m.trader_token_totals[2] = 600;   // weight 2/4
    m.trader_token_totals[3] = 400;   // weight 1/4 — tail
    m.trader_token_totals[5] = 9_999; // outside support — must NOT contribute

    let (expected_sf, _) = compute_scaling_factor(
        &m.trader_token_totals,
        win,
        w,
        m.total_minted,
    )
    .unwrap();
    let expected_aggregate = compute_kernel_payout(
        &m.trader_token_totals,
        win,
        w,
        expected_sf,
    )
    .unwrap();

    resolve_at_bin(&mut m, win as u16);

    assert_eq!(m.scaling_factor, expected_sf);
    assert_eq!(
        expected_aggregate + m.reserves[win] as u128,
        m.total_minted,
        "left-boundary solvency must be exact",
    );
}

/// P5-1 test 6b: winner at the last bin (`num_bins - 1`) — kernel only
/// extends leftward. Symmetric to 6a; verifies the right-boundary
/// truncation also keeps solvency exact.
#[test]
fn test_resolve_continuous_kernel_right_boundary_winner() {
    let num_bins = 16u16;
    let w = 3u16;
    let win = (num_bins - 1) as usize; // 15

    let mut m = blank_market();
    init_continuous_kernel(&mut m, num_bins, w);
    m.total_minted = 5_000;
    m.trader_token_totals = vec![0u64; num_bins as usize];
    m.trader_token_totals[15] = 1_000; // weight 1.0
    m.trader_token_totals[14] = 800;   // weight 3/4
    m.trader_token_totals[13] = 600;   // weight 2/4
    m.trader_token_totals[12] = 400;   // weight 1/4 — tail
    m.trader_token_totals[10] = 9_999; // outside support — must NOT contribute

    let (expected_sf, _) = compute_scaling_factor(
        &m.trader_token_totals,
        win,
        w,
        m.total_minted,
    )
    .unwrap();
    let expected_aggregate = compute_kernel_payout(
        &m.trader_token_totals,
        win,
        w,
        expected_sf,
    )
    .unwrap();

    resolve_at_bin(&mut m, win as u16);

    assert_eq!(m.scaling_factor, expected_sf);
    assert_eq!(
        expected_aggregate + m.reserves[win] as u128,
        m.total_minted,
        "right-boundary solvency must be exact",
    );
}
