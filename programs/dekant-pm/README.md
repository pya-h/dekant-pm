# DekantPM Solana Program

The on-chain Solana program that implements the DekantPM prediction market protocol. Built with [Anchor](https://www.anchor-lang.com/) 0.32.1 in Rust.

This program is the source of truth for all protocol state: markets, trader positions, LP positions, roles, and fees. It implements an L2-norm constant-function AMM (CFAMM) that supports binary, multi-outcome, and continuous distribution markets.

## Deployed Program

| Network | Program ID |
|---------|-----------|
| **Devnet** | `F7dR6Ho8aCm9SBD2aNfJChTdpQpNvPmKjXZGSfjLZHKL` |

Explorer: https://explorer.solana.com/address/F7dR6Ho8aCm9SBD2aNfJChTdpQpNvPmKjXZGSfjLZHKL?cluster=devnet

## Directory Structure

```
programs/dekant-pm/
├── Cargo.toml
└── src/
    ├── lib.rs                 # Entry point: declares all 17 instructions
    ├── constants.rs           # PDA seeds, numeric limits, scale factors, defaults
    ├── errors.rs              # 43 custom error codes
    ├── events.rs              # 11 on-chain event types
    ├── state/                 # Account data structures (PDAs)
    │   ├── mod.rs
    │   ├── protocol_config.rs # Singleton global configuration
    │   ├── market.rs          # Market account (variable-length)
    │   ├── user_position.rs   # Trader token holdings per market
    │   ├── lp_position.rs     # LP share tracking
    │   └── user_role.rs       # Role assignment PDAs
    ├── instructions/          # Instruction handlers
    │   ├── mod.rs
    │   ├── admin/             # initialize, assign_role, revoke_role, update_fees, collect_fees
    │   ├── market/            # create_market, pause_market, unpause_market, resolve_market
    │   └── trading/           # buy, sell, buy_to_price, sell_to_price, buy_distribution,
    │                          # sell_distribution, add_liquidity, remove_liquidity, claim_payout
    └── engine/                # Pure math (no Anchor dependencies)
        ├── mod.rs
        ├── amm.rs             # L2-norm invariant, buy/sell/distribution algorithms
        ├── fixed_point.rs     # Scaled u128 arithmetic (mul_div, etc.)
        ├── sqrt.rs            # Integer square root via Newton's method
        └── normal_pdf.rs      # Gaussian bin weight computation
```

## Account Types

All accounts are PDAs (Program Derived Addresses) — no external keypairs needed.

### ProtocolConfig (singleton)

Seed: `["protocol_config"]`

Global protocol configuration created once during `initialize`.

| Field | Type | Description |
|-------|------|-------------|
| `superadmin` | Pubkey | Wallet with full authority |
| `treasury` | Pubkey | Destination for protocol fees |
| `market_count` | u64 | Auto-incrementing market ID counter |
| `creation_fee_bps` | u16 | Fee on market creation (default: 50 = 0.5%) |
| `trade_fee_bps` | u16 | Fee on each trade (default: 30 = 0.3%) |
| `redemption_fee_bps` | u16 | Fee on payout claims (default: 50 = 0.5%) |
| `lp_fee_share_bps` | u16 | LP share of trade fees (default: 5000 = 50%) |

### Market (variable-length)

Seed: `["market", market_id.to_le_bytes()]`

One PDA per market. Holds all on-chain state including AMM reserves.

| Field | Type | Description |
|-------|------|-------------|
| `market_id` | u64 | Unique auto-incremented ID |
| `market_type` | u8 | 0=Binary, 1=Multi, 2=Continuous |
| `state` | u8 | 0=Active, 1=Paused, 2=PendingResolution, 3=Resolved |
| `creator` | Pubkey | Wallet that created the market |
| `oracle` | Pubkey | Wallet authorized to resolve |
| `collateral_mint` | Pubkey | SPL token mint (e.g., USDC) |
| `vault` | Pubkey | Token account holding collateral |
| `deadline` | i64 | Unix timestamp after which trading stops |
| `num_outcomes` | u16 | Number of outcomes (2 for binary, up to 256 for continuous) |
| `reserves` | Vec\<u64\> | Collateral reserves per outcome/bin |
| `k_squared` | u128 | L2-norm invariant value |
| `total_minted` | u128 | Total collateral deposited into the AMM |
| `range_min`, `range_max` | i64 | Continuous market range (SCALE-denominated) |
| `resolved_outcome` | u16 | Winning outcome index (discrete markets) |
| `resolved_value` | i64 | Resolved value (continuous markets, SCALE-denominated) |
| `lp_fee_accumulated` | u128 | Accumulated LP fees |
| `protocol_fee_accumulated` | u64 | Accumulated protocol fees |

### UserPosition (variable-length)

Seed: `["user_position", market_pubkey, user_pubkey]`

One PDA per (market, trader) pair. Tracks token holdings across all outcomes.

| Field | Type | Description |
|-------|------|-------------|
| `market` | Pubkey | Market this position belongs to |
| `user` | Pubkey | Trader wallet |
| `holdings` | Vec\<u64\> | Token balance per outcome/bin |
| `total_deposited` | u64 | Cumulative collateral deposited |
| `total_withdrawn` | u64 | Cumulative collateral withdrawn |
| `claimed` | bool | Whether payout has been claimed |

### LpPosition (fixed 114 bytes)

Seed: `["lp_position", market_pubkey, user_pubkey]`

One PDA per (market, LP) pair. Tracks liquidity provider shares.

| Field | Type | Description |
|-------|------|-------------|
| `market` | Pubkey | Market this LP position belongs to |
| `user` | Pubkey | LP wallet |
| `shares` | u128 | Proportional LP ownership |
| `deposited_collateral` | u64 | Cumulative collateral deposited |

### UserRole (fixed 83 bytes)

Seed: `["user_role", user_pubkey, role_byte]`

One PDA per (user, role) combination. Existence = active role.

| Field | Type | Description |
|-------|------|-------------|
| `user` | Pubkey | Wallet with the role |
| `assigned_by` | Pubkey | Who assigned it |
| `role` | u8 | 1=Admin, 2=Oracle, 3=Creator |
| `assigned_at` | i64 | Unix timestamp |

## Instructions (17)

### Admin (5)

**`initialize`** — One-time protocol setup. Creates ProtocolConfig, sets superadmin, treasury, and default fee parameters.

**`assign_role`** — Grant a role (Admin, Oracle, Creator) to a wallet. Superadmin can assign any role; Admins can only assign Oracle and Creator.

**`revoke_role`** — Revoke a role by closing its UserRole PDA. Reclaims rent to the revoker.

**`update_fees`** — Update any of the four fee parameters. Superadmin only. Each fee capped at `MAX_FEE_BPS` (5000 = 50%).

**`collect_fees`** — Sweep accumulated protocol fees from a market's vault to the treasury token account. Superadmin only.

### Market Management (4)

**`create_market`** — Create a new market (binary, multi, or continuous). Requires Creator+ role. The oracle must hold an Oracle role. Initializes the AMM with uniform probability distribution across all outcomes. Deducts creation fee and transfers initial liquidity to the vault.

**`pause_market`** — Transition Active to Paused. Admin+ or superadmin. Blocks all trading while paused.

**`unpause_market`** — Transition Paused back to Active, or to PendingResolution if the deadline has already passed.

**`resolve_market`** — Oracle submits the winning outcome (discrete) or resolved value (continuous). Transitions to Resolved. Emits `MarketResolved` event.

### Trading (9)

**`buy`** — Buy tokens for a single discrete outcome. Mints complete sets (adds collateral to all reserves), then drains the target outcome's reserve. Fee split between LP and protocol.

**`sell`** — Sell tokens for a single discrete outcome. Returns tokens to the reserve, computes collateral to burn, applies fee.

**`buy_to_price`** — Buy until the target outcome reaches a specified probability. Takes `max_collateral` as a safety limit.

**`sell_to_price`** — Sell until the target outcome drops to a specified probability. Takes `min_collateral_out` as a safety floor.

**`buy_distribution`** — Continuous markets only. Buy across all bins proportional to Normal(mu, sigma) weights. Computes a single lambda parameter that distributes collateral optimally.

**`sell_distribution`** — Continuous markets only. Sell across all bins proportional to Normal(mu, sigma) weights.

**`add_liquidity`** — Deposit collateral as a liquidity provider. First LP receives shares equal to collateral. Subsequent LPs receive `shares = lp_shares_total * amount / total_minted`.

**`remove_liquidity`** — Burn LP shares, receive proportional collateral plus accumulated LP fee share.

**`claim_payout`** — After resolution, claim payout from winning outcome tokens. Payout = `(winning_tokens * total_minted) / total_winning_tokens`. Applies redemption fee. One-time per position (sets `claimed = true`).

## AMM Math

### L2-Norm Invariant

The AMM uses a position-based L2-norm invariant:

```
x[i] = total_minted - reserves[i]    (position in outcome i)

Invariant: Sum(x[i]^2) = k^2         (where k = total_minted)
```

This gives implied probabilities: `price[i] = x[i]^2 / k^2`.

### Buy Algorithm

1. Apply fees (split into LP and protocol portions)
2. Mint complete sets: `reserves[i] += effective_collateral` for all i
3. Update k: `k_new = total_minted + effective_collateral`
4. Solve for new position: `x_new[target] = isqrt(k_new^2 - Sum_{j!=target}(x[j]^2))`
5. Tokens out: `x_new[target] - x_old[target]`
6. Update reserve: `reserves[target] = k_new - x_new[target]`

### Sell Algorithm

1. Add tokens to reserve: `reserves[target] += tokens_in`
2. Compute new invariant: `k_new = isqrt(Sum(x_new[i]^2))`
3. Collateral out: `total_minted - k_new`
4. Subtract from all reserves, apply fee

### Distribution Trading

For continuous markets, traders specify Normal(mu, sigma) parameters:

1. Compute bin weights using Gaussian PDF: `w[i] = pdf((bin_center - mu) / sigma)`
2. Normalize weights to sum to SCALE (10^9)
3. For buy: solve for lambda such that all bins move along their weighted directions while maintaining the invariant
4. For sell: distribute tokens proportionally to weights across all bins

Tails are clamped at |z| > 5 (weight = 0).

### Fixed-Point Arithmetic

- `SCALE = 10^9` for probabilities and weights
- All intermediate products use u128 to prevent overflow
- `mul_div(a, b, c)` computes `(a * b) / c` in u128
- Integer square root via Newton's method, converges in at most 64 iterations
- Invariant tolerance of 256 accounts for rounding

## Events (11)

| Event | Emitted By | Key Fields |
|-------|-----------|------------|
| `MarketCreated` | `create_market` | market_id, market_type, creator, oracle, num_outcomes |
| `MarketPaused` | `pause_market` | market_id |
| `MarketUnpaused` | `unpause_market` | market_id, new_state |
| `MarketResolved` | `resolve_market` | market_id, outcome, value |
| `TradePlaced` | buy/sell/distribution | market_id, trader, is_buy, collateral, tokens, fee |
| `PayoutClaimed` | `claim_payout` | market_id, user, gross_payout, net_payout |
| `LiquidityChanged` | add/remove_liquidity | market_id, provider, is_add, shares_changed, collateral |
| `FeesCollected` | `collect_fees` | market_id, amount |
| `FeesUpdated` | `update_fees` | creation, trade, redemption, lp_share |
| `RoleAssigned` | `assign_role` | user, role, assigned_by |
| `RoleRevoked` | `revoke_role` | user, role |

These events are indexed by the backend to keep the PostgreSQL cache in sync.

## Error Codes (43)

**Authorization:** `Unauthorized`, `InvalidRole`, `RoleAlreadyAssigned`, `AdminCannotAssignAdmin`

**Market Lifecycle:** `MarketNotActive`, `MarketClosed`, `MarketNotPendingResolution`, `MarketAlreadyResolved`, `MarketPaused`, `MarketNotPaused`, `MarketNotResolved`

**Creation Validation:** `InvalidOutcome`, `InvalidRange`, `InvalidDeadline`, `InvalidNumOutcomes`, `InvalidMarketType`, `BinCountExceeded`

**Trading:** `InsufficientBalance`, `InsufficientLiquidity`, `InsufficientHoldings`, `TradeTooSmall`, `InvalidSigma`, `WrongMarketType`, `InvalidProbability`, `TargetAlreadyMet`, `MaxCollateralExceeded`, `MinCollateralNotMet`

**Settlement:** `AlreadyClaimed`, `NothingToClaim`

**Math:** `InvariantViolation`, `MathOverflow`, `DivisionByZero`, `SqrtFailed`

**Fees:** `FeeTooHigh`, `NoFeesToCollect`

**LP:** `InsufficientShares`, `LiquidityTooSmall`

**Resolution:** `ResolvedValueOutOfRange`

## Build & Test

### Prerequisites

- **Rust** 1.79+ (via `rustup`)
- **Solana CLI** v1.18+
- **Anchor CLI** v0.32.1
- **Node.js** v20.18+ and **Yarn** v1 (for integration tests)

### Build

```bash
anchor build
```

Outputs:
- `target/deploy/dekant_pm.so` — compiled BPF program
- `target/idl/dekant_pm.json` — Anchor IDL (used by backend and frontend)

### Rust Unit Tests

205 unit tests covering AMM math, fixed-point arithmetic, state machine transitions, and normal PDF computation:

```bash
cargo test --manifest-path programs/dekant-pm/Cargo.toml
```

### Integration Tests

70 integration tests across 9 suites covering the full protocol lifecycle:

1. **Protocol Setup** — Initialize, role assignment, fee updates
2. **Binary Market** — Create, buy, sell, add/remove liquidity, resolve, claim payout
3. **Multi-Outcome Market** — 4-outcome market lifecycle
4. **Continuous Market** — Distribution buy/sell with Normal PDF
5. **Error Cases** — Insufficient balance, deadline enforcement, minimum trade
6. **Role Revocation** — Superadmin/admin revoke, unauthorized attempts
7. **Paused Market Resolution** — Pause blocks oracle, unpause re-enables resolution
8. **Sell Distribution** — Continuous sell, min trade, wrong market type guards
9. **Superadmin Pause** — Pause without role PDA, unauthorized pause rejection

```bash
# From the project root:
anchor test

# Without restarting the local validator:
anchor test --skip-local-validator
```

### Deploy

**Localnet:**
```bash
solana-test-validator    # in a separate terminal
anchor deploy --provider.cluster localnet
```

**Devnet:**
```bash
solana airdrop 5 --url devnet
anchor deploy --provider.cluster devnet
```

The program ID is declared in `lib.rs` (`declare_id!`) and `Anchor.toml`. To deploy under a different keypair, update both and regenerate `target/deploy/dekant_pm-keypair.json`.

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| **L2-norm (not LMSR/CPMM)** | Supports distribution trading natively; invariant is sum-of-squares, not product |
| **Lazy deadline enforcement** | No crank or keeper needed; first post-deadline instruction triggers state transition |
| **PDA-based roles** | Role existence = authorization; no separate registry account needed |
| **u128 fixed-point (SCALE=10^9)** | Avoids floating-point entirely; integer sqrt via Newton's method; 18+ digits of precision |
| **Variable-length reserves** | Vec\<u64\> in Market account supports 2-256 outcomes without separate accounts |
| **Checked math everywhere** | All arithmetic uses `checked_*` operations; overflows caught, not wrapped |
| **Event-rich logging** | All state changes emit events for indexer reliability; enables full reconstruction |
| **Payout from total_minted** | Uses total_minted (not vault balance) for payout calculation; order-independent, prevents first-claimer advantage |

## License

All rights reserved.
