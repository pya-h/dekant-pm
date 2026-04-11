# DekantPM — Implementation Task Breakdown

**Derived from:** TDD v1.0
**Convention:** Each task is one focused coding session. Tasks are ordered by dependency — a task's prerequisites are listed in `Depends on`. Cross-layer dependencies (e.g., frontend needs program deployed) are noted explicitly.

---

## Dependency Graph (Visual)

```
INFRASTRUCTURE
  I-1 ──► I-2 ──► I-3
                    │
          ┌─────────┘
          ▼
ON-CHAIN PROGRAM
  P-1 ──► P-2 ──► P-3 ──► P-4
                    │        │
                    ▼        ▼
                  P-5 ──► P-6 ──► P-7 (AMM engine)
                    │               │
                    ├───────────────┤
                    ▼               ▼
                  P-8             P-9 ──► P-10
                  (admin)        (create_market)
                    │               │
                    ▼               ▼
                  P-11 ◄──────── P-12 (buy discrete)
                  (role)            │
                                    ▼
                                 P-13 (sell discrete)
                                    │
                                    ▼
                                 P-14 (buy_distribution)
                                    │
                                    ▼
                                 P-15 (sell_distribution)
                                    │
                    ┌───────────────┤
                    ▼               ▼
                  P-16            P-17
                  (LP)            (pause/resolve)
                    │               │
                    └───────┬───────┘
                            ▼
                          P-18 (claim_payout)
                            │
                            ▼
                          P-19 (events)
                            │
                            ▼
                          P-20 (integration tests)
                            │
          ┌─────────────────┘
          ▼
BACKEND
  B-1 ──► B-2 ──► B-3 ──► B-4 ──► B-5 ──► B-6 ──► B-7 ──► B-8
                                                      │
                                                      ├──► B-9
                                                      │   (dist sell est)
          ┌───────────────────────────────────────────┘     │
          ▼                                                 │
FRONTEND                                                    │
  F-1 ──► F-2 ──► F-3 ──► F-4 ──► F-5 ──► F-6 ──► F-7 ──► F-8
                                                    │
                                    ┌───────────────┤
                                    ▼               ▼
                                  F-9             F-10
                                  (portfolio)     (admin)
                                    │               │
                                    ▼               ▼
                                  F-11            F-12
                                  (claim)         (oracle)
                                                    │
                                                    ▼
                                                  F-13
                                                  (E2E smoke)

  F-7 + B-9 ──► F-14 (continuous sell UI)

DEVKIT (program interaction scripts)
  S-1 ──► S-2 ──► S-3 ──► S-4
  (setup)  (market)  (trade)  (resolve/claim)
```

---

## Infrastructure Tasks

### I-1: Monorepo Scaffolding ✅

**Goal:** Set up the top-level project structure so all layers can coexist.

**Deliverable:**
- Root directory with workspace layout:
  ```
  pm-cont/
  ├── programs/dekant-pm/        # Anchor program (Rust)
  ├── backend/               # NestJS app
  ├── frontend/              # Next.js app
  ├── packages/shared/       # Shared types (IDL-derived)
  ├── scripts/               # Deploy, seed, migrate
  ├── Anchor.toml
  ├── package.json           # Workspace root (pnpm/yarn workspaces)
  ├── tsconfig.base.json
  └── .gitignore
  ```
- `.gitignore` covers Rust targets, node_modules, .env, .anchor, test-ledger
- Root `package.json` with workspace configuration (pnpm recommended)
- `README.md` with project name and structure overview only

**Depends on:** Nothing

---

### I-2: Anchor Project Initialization ✅

**Goal:** Create a buildable Anchor program skeleton.

**Deliverable:**
- `anchor init` inside `programs/dekant-pm/` (or adjust `Anchor.toml` to point there)
- `Anchor.toml` configured for devnet, program keypair generated
- Verify `anchor build` succeeds with the empty program
- Verify `anchor test` runs the default test

**Depends on:** I-1

---

### I-3: Local Dev Environment Config ✅

**Goal:** Everything needed to develop, build, and test locally.

**Deliverable:**
- `Anchor.toml` with `[test]` section using `solana-test-validator`
- Docker Compose file with PostgreSQL 16 service (port 5432, user/pass/db)
- `.env.example` with all required env vars:
  ```
  SOLANA_RPC_URL=http://localhost:8899
  DATABASE_URL=postgresql://dekant_pm:dekant_pm@localhost:5432/dekant_pm
  PROGRAM_ID=<from anchor build>
  ```
- `scripts/setup-dev.sh` that starts PostgreSQL, builds the program, runs validator
- Verify: a developer can clone, run setup script, and `anchor test` passes

**Depends on:** I-2

---

## On-Chain Program Tasks

### P-1: Constants & Error Definitions ✅

**Goal:** Define all program constants and custom error codes used across instructions.

**Deliverable — `constants.rs`:**
- Seed prefixes: `PROTOCOL_CONFIG_SEED`, `USER_ROLE_SEED`, `MARKET_SEED`, `VAULT_AUTHORITY_SEED`, `USER_POSITION_SEED`, `LP_POSITION_SEED`
- Numeric limits: `MAX_OUTCOMES` (32), `MAX_BINS` (256), `MIN_LIQUIDITY`, `MIN_TRADE_AMOUNT`
- Scale factor: `SCALE = 1_000_000_000u128`
- Fee defaults: `DEFAULT_CREATION_FEE_BPS`, `DEFAULT_TRADE_FEE_BPS`, `DEFAULT_REDEMPTION_FEE_BPS`, `DEFAULT_LP_FEE_SHARE_BPS`
- Market types: `MARKET_TYPE_BINARY`, `MARKET_TYPE_MULTI`, `MARKET_TYPE_CONTINUOUS`
- Market states: `STATE_ACTIVE`, `STATE_PAUSED`, `STATE_PENDING_RESOLUTION`, `STATE_RESOLVED`
- Role types: `ROLE_ADMIN`, `ROLE_ORACLE`, `ROLE_CREATOR`

**Deliverable — `errors.rs`:**
- `DekantPmError` enum with all error codes:
  - `Unauthorized`, `InvalidRole`, `RoleAlreadyAssigned`
  - `MarketNotActive`, `MarketClosed`, `MarketNotPendingResolution`, `MarketAlreadyResolved`
  - `InvalidOutcome`, `InvalidRange`, `InvalidDeadline`, `InvalidNumOutcomes`
  - `InsufficientBalance`, `InsufficientLiquidity`, `InsufficientHoldings`
  - `InvariantViolation`, `MathOverflow`, `DivisionByZero`
  - `AlreadyClaimed`, `NothingToClaim`
  - `MarketPaused`, `MarketNotPaused`
  - `TradeTooSmall`, `BinCountExceeded`

**Depends on:** I-2

---

### P-2: Fixed-Point Math Library ✅

**Goal:** Implement the core arithmetic primitives that all AMM math depends on.

**Deliverable — `engine/fixed_point.rs`:**
- `scaled_mul(a: u128, b: u128) -> Result<u128>` — multiply two SCALE-ed values
- `scaled_div(a: u128, b: u128) -> Result<u128>` — divide with SCALE precision
- `checked_add_u128`, `checked_sub_u128`, `checked_mul_u128` — wrappers that return DekantPmError::MathOverflow
- Rounding helpers: `div_ceil(a: u128, b: u128)`, `div_floor(a: u128, b: u128)`

**Deliverable — `engine/sqrt.rs`:**
- `isqrt(n: u128) -> u128` — integer square root via Newton's method
- Unit tests: `isqrt(0)=0`, `isqrt(1)=1`, `isqrt(4)=2`, `isqrt(2)=1`, `isqrt(u128::MAX)`, large values like `isqrt(10^24)`

**Deliverable — Unit tests:**
- Verify `scaled_mul(SCALE, SCALE) = SCALE`
- Verify `scaled_div(SCALE, 2) = SCALE/2`
- Overflow edge cases
- isqrt accuracy: `isqrt(n)^2 <= n < (isqrt(n)+1)^2`

**Depends on:** P-1

---

### P-3: Normal PDF Approximation ✅

**Goal:** Implement on-chain Gaussian bin weight computation for continuous markets.

**Deliverable — `engine/normal_pdf.rs`:**
- `exp_approx(t: u128) -> u128` — approximates `exp(-t/2)` in fixed-point using degree-4 Horner polynomial. Input `t = z²` scaled to SCALE. Output scaled to SCALE.
- `compute_bin_weights(range_min: i64, range_max: i64, num_bins: u16, mu: i64, sigma: u64) -> Vec<u64>` — returns normalized bin weights. Tail cutoff at |z| > 5. Weights sum to SCALE.
- Internal: `z_squared(bin_center: i64, mu: i64, sigma: u64) -> u128`

**Unit tests:**
- Symmetric distribution: weights for mu at range center should be symmetric
- Narrow sigma: weight concentrated in few bins, rest near zero
- Wide sigma: weights nearly uniform across all bins
- Edge: mu at range boundary
- Edge: sigma very small (< 1 bin width) — all weight in one bin
- Accuracy: compare against f64 reference implementation (allow 0.5% error)

**Depends on:** P-2

---

### P-4: Account State Structs ✅

**Goal:** Define all Anchor `#[account]` structs with correct sizing and serialization.

**Deliverable — `state/protocol_config.rs`:**
- `ProtocolConfig` struct matching TDD §3.1 (154 bytes)
- `impl ProtocolConfig { pub const SIZE: usize = ... }`

**Deliverable — `state/user_role.rs`:**
- `UserRole` struct matching TDD §3.2 (83 bytes)
- `Role` enum (Admin=1, Oracle=2, Creator=3)

**Deliverable — `state/market.rs`:**
- `Market` struct matching TDD §3.3 (288 + N*8 bytes)
- `MarketType` enum (Binary=0, Multi=1, Continuous=2)
- `MarketState` enum (Active=0, Paused=1, PendingResolution=2, Resolved=3)
- `impl Market { pub fn size(num_outcomes: u16) -> usize }`
- Helper: `pub fn implied_probability(&self, outcome: u16) -> u128`

**Deliverable — `state/user_position.rs`:**
- `UserPosition` struct matching TDD §3.4 (107 + N*8 bytes)
- `impl UserPosition { pub fn size(num_outcomes: u16) -> usize }`

**Deliverable — `state/lp_position.rs`:**
- `LpPosition` struct matching TDD §3.5 (114 bytes)

**Depends on:** P-1

---

### P-5: AMM Engine — Core L2-Norm Operations ✅

**Goal:** Implement the pure-computation AMM engine that instructions call into. No Anchor context — just math functions on slices.

**Deliverable — `engine/amm.rs`:**

1. **Invariant verification:**
   ```
   verify_invariant(reserves: &[u64], k_squared: u128) -> Result<()>
   ```
   Computes `Σ reserves[i]²`, checks it equals `k_squared` within ±1 tolerance.

2. **Discrete buy (single outcome):**
   ```
   compute_buy(
     reserves: &mut [u64],
     k_squared: u128,
     outcome: u16,
     effective_collateral: u64,
   ) -> Result<u64>  // returns tokens_out
   ```
   Implements TDD §5.3: mint complete sets, drain outcome i to restore invariant, return excess.

3. **Discrete sell (single outcome):**
   ```
   compute_sell(
     reserves: &mut [u64],
     k_squared: u128,
     outcome: u16,
     tokens_in: u64,
   ) -> Result<u64>  // returns collateral_out
   ```
   Implements TDD §5.3: add tokens back, solve quadratic for burn amount, return collateral.

4. **Quadratic solver:**
   ```
   solve_burn_amount(reserves: &[u64], k_squared: u128) -> Result<u64>
   ```
   Implements TDD §5.6.

5. **Implied probabilities:**
   ```
   compute_probabilities(reserves: &[u64], k_squared: u128) -> Vec<u64>
   ```
   Returns `price[i] = reserves[i]² * SCALE / k_squared` for each outcome.

**Unit tests:**
- Buy on uniform market → prices shift correctly
- Buy then sell same amount → near-zero net (within rounding)
- Large buy → price of that outcome increases, others decrease
- Probabilities sum to SCALE (within ±N rounding error)
- Invariant holds after every operation
- Edge: buy all of one outcome → should fail (reserves[i] can't go below 0)
- Edge: sell more than held → should fail

**Depends on:** P-2, P-4

---

### P-6: AMM Engine — Distribution Buy/Sell ✅

**Goal:** Implement the multi-bin trade operations for continuous markets.

**Deliverable — `engine/amm.rs` (additions):**

1. **Distribution buy:**
   ```
   compute_distribution_buy(
     reserves: &mut [u64],
     k_squared: u128,
     weights: &[u64],        // Normalized bin weights (sum = SCALE)
     effective_collateral: u64,
   ) -> Result<Vec<u64>>     // tokens_out per bin
   ```
   Implements TDD §5.4: mint complete sets, solve quadratic for λ, distribute tokens proportionally to weights.

2. **Distribution sell:**
   ```
   compute_distribution_sell(
     reserves: &mut [u64],
     k_squared: u128,
     weights: &[u64],        // Proportional to tokens being returned
     total_tokens: u64,
   ) -> Result<u64>          // collateral_out
   ```
   Reverse of buy: add tokens back proportionally, solve for burn amount.

**Unit tests:**
- Uniform weights → equivalent to buying all outcomes equally (≈ no price change, just minting)
- Single-bin weight → equivalent to discrete buy on that bin
- Normal-shaped weights → prices shift toward that center
- Buy distribution then sell same distribution → near-zero net
- Invariant holds after every operation
- Lambda solver: verify the quadratic produces valid results for various reserve states

**Depends on:** P-3, P-5

---

### P-7: Initialize Instruction ✅

**Goal:** Implement the one-time protocol setup instruction.

**Deliverable — `instructions/admin/initialize.rs`:**
- Accounts context: `signer` (deployer), `protocol_config` (init PDA), `system_program`
- Logic:
  - Verify signer matches expected deployer (can hardcode or pass as argument for devnet flexibility)
  - Set `superadmin = signer`
  - Set `treasury` from argument
  - Set default fee values from constants
  - Set `market_count = 0`
  - Store bump
- Register in `lib.rs`

**Deliverable — Test:**
- Happy path: initialize succeeds, ProtocolConfig has correct values
- Fail: double initialization (PDA already exists)

**Depends on:** P-4

---

### P-8: Role Management Instructions ✅

**Goal:** Implement assign_role, revoke_role, and update_fees.

**Deliverable — `instructions/admin/assign_role.rs`:**
- Accounts: `authority` (signer), `authority_role` (optional, for admin), `protocol_config`, `user_role` (init), `target_user`, `system_program`
- Logic:
  - Check authority is superadmin OR has admin role
  - If authority is admin: can only assign Oracle, Creator (not Admin)
  - If authority is superadmin: can assign any role
  - Init UserRole PDA with seeds `["user_role", target_user, role_type]`
  - Set fields: user, role, assigned_by, assigned_at, bump
- Emit `RoleAssigned` event

**Deliverable — `instructions/admin/revoke_role.rs`:**
- Same authority checks
- Close the UserRole PDA (Anchor `close` constraint), return rent to authority
- Emit `RoleRevoked` event

**Deliverable — `instructions/admin/update_fees.rs`:**
- Only superadmin
- Update fee fields in ProtocolConfig
- Validate: each fee ≤ 5000 bps (50% cap as safety)

**Tests:**
- Superadmin assigns admin → success
- Admin assigns oracle → success
- Admin assigns admin → fail (privilege escalation)
- Random wallet assigns → fail
- Revoke role → UserRole PDA closed
- Update fees → values change
- Update fees by non-superadmin → fail

**Depends on:** P-7

---

### P-9: Create Market Instruction ✅

**Goal:** Implement market creation with initial liquidity deposit.

**Deliverable — `instructions/market/create_market.rs`:**
- Accounts: `creator` (signer), `creator_role` (verify Creator/Admin/Superadmin), `protocol_config` (mut, to increment market_count), `market` (init, space = Market::size(num_outcomes)), `collateral_mint`, `vault_authority` (PDA), `vault` (init ATA), `creator_ata`, `oracle_role` (verify oracle has Oracle role), `token_program`, `associated_token_program`, `system_program`
- Instruction args: `market_type: u8`, `num_outcomes: u16`, `deadline: i64`, `oracle: Pubkey`, `initial_liquidity: u64`, `range_min: i64` (0 if discrete), `range_max: i64` (0 if discrete)
- Logic:
  - Validate market_type (0, 1, or 2)
  - Validate num_outcomes: binary=2, multi=3..32, continuous=2..256
  - Validate deadline > current time
  - Validate initial_liquidity >= MIN_LIQUIDITY
  - If continuous: validate range_max > range_min
  - Verify oracle has Oracle role PDA
  - Charge creation fee: `fee = initial_liquidity * creation_fee_bps / 10_000`
  - Transfer `initial_liquidity` from creator ATA to vault
  - Transfer `fee` from creator ATA to treasury (or deduct from liquidity)
  - Initialize reserves: `reserves[i] = effective_liquidity` for all i
  - Compute `k_squared = num_outcomes * effective_liquidity²`
  - Set `total_minted = effective_liquidity`
  - Set `lp_shares_total = effective_liquidity` (creator gets initial LP shares)
  - Create LpPosition for creator with shares = effective_liquidity
  - Set state = Active
  - Increment protocol_config.market_count
  - Emit `MarketCreated` event

**Tests:**
- Create binary market → success, reserves uniform, k² correct
- Create multi-outcome (5 outcomes) → success
- Create continuous (64 bins) → success, range set
- Fail: non-creator tries to create
- Fail: deadline in past
- Fail: invalid num_outcomes for market type
- Fail: insufficient balance for initial liquidity
- Verify: oracle role checked
- Verify: creation fee deducted

**Depends on:** P-5, P-8

---

### P-10: Buy Instruction (Discrete) ✅

**Goal:** Implement discrete single-outcome buy.

**Deliverable — `instructions/trading/buy.rs`:**
- Accounts: `trader` (signer), `market` (mut), `user_position` (init_if_needed), `vault_authority`, `vault` (mut), `trader_ata` (mut), `protocol_config`, `treasury_ata` (mut), `token_program`, `system_program`
- Instruction args: `outcome: u16`, `collateral_amount: u64`
- Logic:
  - Guard: market.state == Active
  - Guard: clock < market.deadline (else transition to PendingResolution and error)
  - Guard: market.market_type == Binary or Multi
  - Guard: outcome < market.num_outcomes
  - Guard: collateral_amount >= MIN_TRADE_AMOUNT
  - Compute fees (TDD §5.3 step 1)
  - Call `engine::amm::compute_buy()` (TDD §5.3 steps 2-3)
  - Update market.reserves, market.total_minted
  - Init or update UserPosition: holdings[outcome] += tokens_out
  - CPI: transfer collateral from trader to vault
  - CPI: transfer protocol_fee from trader to treasury (or from vault to treasury)
  - Accumulate lp_fee in market.lp_fee_accumulated
  - Verify invariant post-trade
  - Emit `TradePlaced` event

**Tests:**
- Buy outcome 0 on binary market → holdings updated, reserves shifted, price changed
- Multiple buys → prices move further
- Buy on market with non-uniform prices → cost reflects current price
- Fail: wrong market type (continuous market)
- Fail: expired market → state transitions to PendingResolution
- Fail: outcome out of range
- Fail: insufficient balance
- Verify: invariant holds post-trade
- Verify: fees charged correctly

**Depends on:** P-5, P-9

---

### P-11: Sell Instruction (Discrete) ✅

**Goal:** Implement discrete single-outcome sell.

**Deliverable — `instructions/trading/sell.rs`:**
- Same account layout as buy (but user_position is mut, not init_if_needed)
- Instruction args: `outcome: u16`, `token_amount: u64`
- Logic:
  - Same guards as buy (state, deadline, market_type, outcome range)
  - Guard: user_position.holdings[outcome] >= token_amount
  - Call `engine::amm::compute_sell()` (TDD §5.3 sell algorithm)
  - Compute fees on returned collateral
  - Update reserves, total_minted, user holdings
  - CPI: transfer net collateral from vault to trader
  - CPI: transfer fee to treasury
  - Verify invariant
  - Emit `TradePlaced` event (is_buy=false)

**Tests:**
- Buy then sell same amount → near break-even (minus fees)
- Sell partial position → holdings reduced, collateral returned
- Fail: sell more than held
- Fail: sell on expired market
- Verify: invariant holds

**Depends on:** P-10

---

### P-12: Buy Distribution Instruction (Continuous) ✅

**Goal:** Implement continuous market distribution buy.

**Deliverable — `instructions/trading/buy_distribution.rs`:**
- Same account layout as discrete buy
- Instruction args: `mu: i64`, `sigma: u64`, `collateral_amount: u64`
- Logic:
  - Same guards + market.market_type == Continuous
  - Guard: sigma > 0
  - Guard: mu within [range_min, range_max] (recommended, not strict — tails are natural)
  - Compute bin weights via `engine::normal_pdf::compute_bin_weights()`
  - Compute fees
  - Call `engine::amm::compute_distribution_buy(reserves, k_squared, weights, effective_collateral)`
  - Update market.reserves for all bins
  - Update user_position.holdings for all bins
  - Update total_minted, fees
  - Verify invariant
  - Emit `TradePlaced` event (with mu, sigma populated)

**Tests:**
- Buy with mu at center → holdings concentrated around center
- Buy with wide sigma → holdings nearly uniform
- Buy with narrow sigma → holdings concentrated in few bins
- Multiple traders with different distributions → all positions tracked correctly
- Verify: invariant holds
- Verify: CU consumption within budget (test with 64-bin and 256-bin markets)

**Depends on:** P-6, P-10

---

### P-13: Sell Distribution Instruction (Continuous) ✅

**Goal:** Implement continuous market distribution sell.

**Deliverable — `instructions/trading/sell_distribution.rs`:**
- Instruction args: `mu: i64`, `sigma: u64`, `token_amount: u64`
- Logic:
  - Compute bin weights
  - Scale weights by token_amount to get per-bin sell amounts
  - Verify user has sufficient holdings in each bin
  - Call `engine::amm::compute_distribution_sell()`
  - Update reserves, holdings, total_minted
  - Return collateral minus fees
  - Verify invariant
  - Emit event

**Tests:**
- Buy then sell with same params → near break-even
- Sell partial → holdings reduced proportionally
- Fail: sell more than held in any bin

**Depends on:** P-12

---

### P-14: Liquidity Instructions (Add & Remove) ✅

**Goal:** Implement proportional LP deposit and withdrawal.

**Deliverable — `instructions/trading/add_liquidity.rs`:**
- Accounts: `lp` (signer), `market` (mut), `lp_position` (init_if_needed), `vault`, `lp_ata`, `token_program`, `system_program`
- Instruction args: `amount: u64`
- Logic (TDD §5.7):
  - Guard: market state Active
  - Guard: amount >= MIN_LIQUIDITY
  - Compute scale_factor = amount / total_minted
  - Scale all reserves[i] up proportionally
  - Update k_squared
  - Compute new LP shares
  - Update lp_position, market.lp_shares_total, market.total_minted
  - CPI: transfer amount from LP to vault
  - Emit `LiquidityChanged` event

**Deliverable — `instructions/trading/remove_liquidity.rs`:**
- Instruction args: `shares_to_burn: u128` (or `amount: u64` representing fraction)
- Logic (TDD §5.7):
  - Guard: market state Active OR Resolved (LP can exit after resolution)
  - Compute fraction f = shares / total_shares
  - Compute collateral_out and fee_share
  - Scale all reserves[i] down proportionally
  - Update k_squared
  - Update lp_position, market
  - CPI: transfer collateral_out + fee_share from vault to LP
  - Close LpPosition if shares == 0
  - Emit `LiquidityChanged` event

**Tests:**
- Add liquidity → reserves scale up, prices unchanged
- Remove liquidity → reserves scale down, prices unchanged
- Add then remove → near break-even
- LP exit after resolution → receives residual
- Fail: remove more shares than held

**Depends on:** P-5, P-9

---

### P-15: Pause & Unpause Instructions ✅

**Goal:** Implement admin market controls.

**Deliverable — `instructions/market/pause_market.rs`:**
- Accounts: `authority`, `authority_role` or `protocol_config` (for superadmin check), `market` (mut)
- Logic:
  - Verify admin or superadmin
  - Guard: market.state == Active
  - Set market.state = Paused
  - Emit `MarketPaused` event

**Deliverable — `instructions/market/unpause_market.rs`:**
- Logic:
  - Verify admin or superadmin
  - Guard: market.state == Paused
  - If clock >= deadline: set state to PendingResolution instead of Active
  - Else: set state = Active
  - Emit `MarketUnpaused` event

**Tests:**
- Pause active market → state changes, trades rejected
- Unpause paused market → trades resume
- Unpause after deadline → state goes to PendingResolution
- Fail: pause non-active market
- Fail: non-admin tries to pause

**Depends on:** P-9

---

### P-16: Resolve Market Instruction ✅

**Goal:** Implement oracle resolution.

**Deliverable — `instructions/market/resolve_market.rs`:**
- Accounts: `oracle` (signer), `market` (mut)
- Instruction args: `outcome: u16` (binary/multi) OR `value: i64` (continuous)
- Logic (TDD §7.1):
  - Guard: signer == market.oracle
  - Guard: market.state == PendingResolution
  - Validate outcome based on market_type:
    - Binary: outcome ∈ {0, 1}
    - Multi: outcome < num_outcomes
    - Continuous: range_min ≤ value ≤ range_max
  - For continuous: compute winning bin = `(value - range_min) * num_outcomes / (range_max - range_min)`, clamped to `num_outcomes - 1`
  - Store resolved_outcome, resolved_value, resolved_at
  - Set state = Resolved
  - Emit `MarketResolved` event

**Tests:**
- Resolve binary market → resolved_outcome set
- Resolve multi-outcome → correct index stored
- Resolve continuous → correct winning bin computed
- Fail: wrong oracle
- Fail: market not in PendingResolution
- Fail: invalid outcome value
- Edge: value exactly at range_min, range_max, bin boundary

**Depends on:** P-9

---

### P-17: Claim Payout Instruction ✅

**Goal:** Implement post-resolution payout redemption.

**Deliverable — `instructions/trading/claim_payout.rs`:**
- Accounts: `trader` (signer), `market`, `user_position` (mut), `vault_authority`, `vault` (mut), `trader_ata`, `protocol_config`, `treasury_ata`, `token_program`
- Logic (TDD §5.8):
  - Guard: market.state == Resolved
  - Guard: user_position.claimed == false
  - Compute winning_tokens_total = total_minted - reserves[resolved_outcome]
  - If winning_tokens_total == 0: error NothingToClaim
  - Compute payout_per_token = vault_balance / winning_tokens_total (use floor division)
  - gross_payout = user.holdings[resolved_outcome] * payout_per_token
  - If gross_payout == 0: error NothingToClaim
  - Compute redemption fee
  - net_payout = gross_payout - fee
  - Set user_position.claimed = true
  - CPI: transfer net_payout from vault to trader
  - CPI: transfer fee from vault to treasury
  - Emit `PayoutClaimed` event

**Tests:**
- Win on binary market → correct payout
- Win on multi-outcome → correct payout
- Win on continuous (bin match) → correct payout
- No holdings in winning outcome → NothingToClaim
- Double claim → AlreadyClaimed
- Multiple traders claim → vault stays solvent
- Fee deducted correctly
- LP can remove_liquidity after all traders claim (residual)

**Depends on:** P-16

---

### P-18: Anchor Events ✅

**Goal:** Define and emit all program events listed in TDD §9.2.

**Deliverable — events in `lib.rs` or `events.rs`:**
- `MarketCreated`, `TradePlaced`, `MarketResolved`, `PayoutClaimed`, `LiquidityChanged`, `MarketPaused`, `MarketUnpaused`, `RoleAssigned`, `RoleRevoked`, `FeesUpdated`
- All emitted via `emit!()` in the correct instruction handlers (retrofit if needed)

**Note:** Some events may already be partially added in earlier tasks. This task ensures completeness and correct field population for all events.

**Depends on:** P-7 through P-17

---

### P-19: Integration Tests — Full Market Lifecycle ✅

**Goal:** End-to-end tests covering the complete lifecycle of each market type.

**Deliverable — `tests/lifecycle.ts` (Anchor Mocha/Chai):**

1. **Binary market lifecycle:**
   - Initialize protocol
   - Assign oracle, creator roles
   - Create binary market with initial liquidity
   - Trader A buys "Yes" (outcome 0)
   - Trader B buys "No" (outcome 1)
   - Trader A sells partial position
   - LP adds liquidity
   - Wait for deadline (warp clock or set near-future deadline)
   - Attempt trade after deadline → fails, market transitions to PendingResolution
   - Oracle resolves (outcome 0)
   - Trader A claims payout → receives funds
   - Trader B claims → NothingToClaim (or small amount)
   - LP removes liquidity → receives residual
   - Verify vault is empty (or near-empty)

2. **Multi-outcome market lifecycle:**
   - Same flow with 5 outcomes
   - Multiple traders on different outcomes
   - Resolution with one winning outcome
   - Verify all payouts correct

3. **Continuous market lifecycle:**
   - Create 64-bin continuous market
   - Trader buys distribution N(150, 20)
   - Trader buys distribution N(200, 10)
   - Oracle resolves with value 155
   - Trader 1 claims (higher payout, closer prediction)
   - Trader 2 claims (lower payout, further prediction)
   - Verify payouts proportional to holdings in winning bin

4. **Admin operations:**
   - Pause → trades fail
   - Unpause → trades resume
   - Update fees → new trades use new fee rate

5. **Edge cases:**
   - Zero-value trade → rejected
   - Trade with 1 lamport → rejected (below minimum)
   - All traders on same outcome → winner takes most, AMM residual to LP

**Depends on:** P-18

---

## Backend Tasks

### B-1: NestJS Project Scaffolding ✅

**Goal:** Create the backend project with all dependencies and base configuration.

**Deliverable:**
- `nest new backend` (or manual setup) inside `backend/`
- Dependencies: `@nestjs/typeorm`, `typeorm`, `pg`, `@solana/web3.js`, `@coral-xyz/anchor`, `class-validator`, `class-transformer`, `@nestjs/swagger`
- `tsconfig.json` with strict mode, paths aliased
- `app.module.ts` with TypeORM connection (reads `DATABASE_URL` from env)
- `.env` with `DATABASE_URL`, `SOLANA_RPC_URL`, `PROGRAM_ID`
- Swagger setup at `/api/docs`
- Health check endpoint: `GET /health` → `{ status: "ok" }`
- Verify: `pnpm start:dev` boots without error, health check responds

**Depends on:** I-3

---

### B-2: Database Entities & Migrations ✅

**Goal:** Create TypeORM entities matching the DB schema in TDD §9.3.

**Deliverable:**
- `market.entity.ts` — all columns from `markets` table
- `trade.entity.ts` — all columns from `trades` table
- `user-position.entity.ts` — all columns from `user_positions` table
- `lp-position.entity.ts` — all columns from `lp_positions` table
- `indexer-state.entity.ts` — single-row bookkeeping
- `user-role.entity.ts` — cached role assignments
- TypeORM migration: `initial-schema` that creates all tables and indexes
- Verify: migration runs against local PostgreSQL, tables created

**Depends on:** B-1

---

### B-3: Solana Provider & IDL Setup ✅

**Goal:** Configure the backend's Solana connection and import the program IDL.

**Deliverable:**
- `common/solana.provider.ts`: NestJS provider that creates a `Connection` instance (configurable RPC URL, commitment=confirmed)
- `common/idl.ts`: Import the auto-generated IDL JSON from the Anchor build output. Export typed program interface.
- `common/pda.ts`: Helper functions to derive all PDA addresses:
  - `deriveProtocolConfig(programId)`
  - `deriveUserRole(programId, user, role)`
  - `deriveMarket(programId, marketId)`
  - `deriveVaultAuthority(programId, marketPubkey)`
  - `deriveUserPosition(programId, marketPubkey, user)`
  - `deriveLpPosition(programId, marketPubkey, user)`
- Verify: PDA derivations match program expectations (test against known seeds)

**Depends on:** B-1, P-19 (needs built IDL from successful program build)

---

### B-4: Auth Module (Wallet Signature Verification) ✅

**Goal:** Implement wallet-based authentication for admin endpoints.

**Deliverable:**
- `auth/auth.service.ts`:
  - `createChallenge(walletAddress: string) -> { nonce: string, message: string }` — generate a random nonce, store in memory/cache
  - `verifySignature(walletAddress: string, signature: string, nonce: string) -> { jwt: string }` — verify ed25519 signature, issue JWT
- `auth/auth.guard.ts`: NestJS guard that validates JWT on protected routes
- `auth/auth.controller.ts`: `POST /auth/challenge`, `POST /auth/verify`
- JWT secret from env, expiry 24h

**Tests:**
- Valid signature → JWT issued
- Invalid signature → 401
- Expired nonce → 401

**Depends on:** B-1

---

### B-5: Market Module (CRUD + Search) ✅

**Goal:** Implement market metadata storage and discovery API.

**Deliverable:**
- `market/market.service.ts`:
  - `create(dto: CreateMarketDto)` — store metadata (title, description, category, tags, outcome_labels) + cached on-chain state
  - `findAll(filters: MarketFilterDto)` — paginated search with filters: category, market_type, state, deadline range, text search on title
  - `findById(id: number)` — single market detail
  - `updateCachedState(id: number, onChainData)` — called by indexer to refresh cached reserves, state, etc.
- `market/market.controller.ts`:
  - `GET /markets` — public, paginated, filterable
  - `GET /markets/:id` — public
  - `POST /markets` — authenticated (Creator+), creates metadata record
  - `GET /markets/:id/prices` — returns current implied probabilities from cached reserves
  - `GET /markets/:id/history` — returns trades for this market
- `market/dto/`: CreateMarketDto, MarketFilterDto with class-validator decorators

**Tests:**
- Create market metadata → stored in DB
- List markets with filters → correct results
- Search by title → matches
- Prices computed from cached reserves → correct probabilities

**Depends on:** B-2, B-4

---

### B-6: Indexer Service ✅

**Goal:** Implement on-chain event listener that populates the database.

**Deliverable:**
- `indexer/indexer.service.ts`:
  - `onModuleInit()`: start WebSocket subscription + backfill from last_processed_slot
  - `handleLog(log)`: parse Anchor events from program logs using `@coral-xyz/anchor` EventParser
  - Event handlers:
    - `MarketCreated` → create/update `markets` row (on-chain fields only; metadata from B-5)
    - `TradePlaced` → insert `trades` row, update `markets.total_volume`, `markets.last_trade_at`, `markets.total_traders` (unique count), refresh cached reserves via RPC getAccountInfo
    - `MarketResolved` → update `markets.state`, `markets.resolved_outcome`, `markets.resolved_at`
    - `PayoutClaimed` → update `user_positions.claimed`
    - `LiquidityChanged` → update `lp_positions`, refresh cached reserves
    - `MarketPaused` / `MarketUnpaused` → update `markets.state`
    - Role events → update `user_roles` table
  - Backfill: use `connection.getSignaturesForAddress(programId)` to walk backwards from current slot to last_processed_slot, parse each tx's logs
  - Health check: every 60s, compare `markets.state` in DB vs on-chain for a random sample

- `indexer/parser.ts`: anchor event parsing helpers

**Tests:**
- Mock a MarketCreated event → market row created
- Mock a TradePlaced event → trade row created, market stats updated
- Backfill from genesis → all historical events captured

**Depends on:** B-3, B-5

---

### B-7: AMM Estimation Service ✅

**Goal:** Off-chain AMM simulation for instant cost previews.

**Deliverable:**
- `amm/amm.service.ts`:
  - `estimateBuy(marketId, outcome, collateralAmount)` → `{ tokensOut, fee, newProbabilities }`
  - `estimateSell(marketId, outcome, tokenAmount)` → `{ collateralOut, fee, newProbabilities }`
  - `estimateDistributionBuy(marketId, mu, sigma, collateralAmount)` → `{ tokensPerBin[], fee, newProbabilities }`
  - `estimateDistributionSell(marketId, mu, sigma, tokenAmount)` → `{ collateralOut, fee, newProbabilities }`
  - Uses cached reserves from DB (not RPC) for speed
  - Mirrors the on-chain AMM math exactly in TypeScript (floating-point OK since this is informational only)
- `amm/normal.ts`: Normal PDF bin weight computation in TypeScript
- `amm/amm.controller.ts`:
  - `POST /amm/estimate-buy` → body: `{ marketId, outcome, amount }`
  - `POST /amm/estimate-sell` → body: `{ marketId, outcome, amount }`

**Tests:**
- Estimate buy → tokens_out matches on-chain result (within rounding)
- Estimate with zero amount → returns zero
- Estimate on non-existent market → 404

**Depends on:** B-5

---

### B-8: User & Admin Endpoints ✅

**Goal:** Implement remaining API routes for user positions and admin operations.

**Deliverable:**
- `user/user.service.ts`:
  - `getPositions(walletAddress)` → all positions across markets (from cached user_positions table)
  - `getTradeHistory(walletAddress)` → paginated trade history
- `user/user.controller.ts`:
  - `GET /users/:address/positions`
  - `GET /users/:address/history`
- Admin endpoints (in market controller or separate admin controller):
  - `GET /admin/roles` → list all role assignments (authenticated, admin+)
  - `GET /admin/markets/stale` → markets in PendingResolution for > 7 days

**Tests:**
- Get positions for wallet with trades → returns correct positions
- Get positions for wallet with no trades → returns empty
- Stale markets → returns markets past threshold

**Depends on:** B-6

---

### B-9: Distribution Sell Estimation

**Goal:** Add off-chain distribution sell simulation to the AMM service (missing from B-7 deliverables).

**Context:** The on-chain `sell_distribution` instruction and `compute_distribution_sell` engine function are fully implemented. The backend's `estimateDistributionSell` was spec'd in B-7 but never implemented. This blocks the frontend sell UI for continuous markets.

**Deliverable:**
- `amm/amm.service.ts`:
  - `estimateDistributionSell(marketId, mu, sigma, tokenAmount)` → `{ collateralOut, fee, newProbabilities }`
  - Private `computeDistributionSell(reserves, totalMinted, weights, tokenAmount)` helper mirroring on-chain algorithm
- `amm/dto/amm.dto.ts`:
  - Add optional `mu?: number` and `sigma?: number` fields to `EstimateSellDto`
- `amm/amm.controller.ts`:
  - Update `estimateSell` handler to check for mu/sigma and route to `estimateDistributionSell` (same pattern as `estimateBuy`)

**Tests:**
- Distribution sell estimate returns valid collateral_out and fee
- Distribution sell with zero tokens → returns zero
- Distribution sell on non-continuous market → 400

**Depends on:** B-7

---

## Frontend Tasks

### F-1: Next.js Project Scaffolding ✅

**Goal:** Create the frontend project with all base dependencies and configuration.

**Deliverable:**
- `npx create-next-app frontend` (App Router, TypeScript, Tailwind, ESLint)
- Install dependencies: `@solana/wallet-adapter-react`, `@solana/wallet-adapter-wallets`, `@solana/wallet-adapter-react-ui`, `@coral-xyz/anchor`, `@solana/web3.js`, `@tanstack/react-query`, `react-hook-form`, `zod`, `@hookform/resolvers`
- Install shadcn/ui: `npx shadcn@latest init` (dark mode, zinc theme)
- Add base shadcn components: Button, Card, Input, Slider, Dialog, Dropdown, Badge, Toast, Tabs, Tooltip
- Tailwind config: dark mode = "class", extend with custom colors if needed
- Verify: `pnpm dev` shows the default Next.js page

**Depends on:** I-1

---

### F-2: Wallet & Provider Setup ✅

**Goal:** Configure Solana wallet integration and global providers.

**Deliverable — `app/layout.tsx` (root layout):**
- `SolanaProvider` component wrapping:
  - `ConnectionProvider` (RPC URL from env)
  - `WalletProvider` (Phantom, Solflare, Backpack adapters)
  - `WalletModalProvider`
- `QueryClientProvider` (TanStack Query)
- Dark mode as default (`<html class="dark">`)
- Global CSS: import Tailwind base, wallet adapter styles

**Deliverable — `components/common/WalletButton.tsx`:**
- Wallet multi-button (connect/disconnect/change wallet)
- Shows truncated address when connected

**Deliverable — `lib/solana.ts`:**
- Exported `useProgram()` hook: returns an Anchor `Program` instance connected to the user's wallet
- Exported `usePDA()` hooks for deriving common PDAs

**Tests (manual):**
- Open page → dark mode, wallet button visible
- Click connect → Phantom popup
- Connect → address shown
- Disconnect → button returns to "Connect Wallet"

**Depends on:** F-1, P-19 (needs IDL JSON from built program)

---

### F-3: Layout & Navigation Shell ✅

**Goal:** Build the persistent layout (navbar, sidebar, footer).

**Deliverable:**
- `components/layout/Navbar.tsx`: Logo ("DekantPM"), nav links (Markets, Portfolio, Admin, Oracle), WalletButton on the right
- `components/layout/Footer.tsx`: Minimal footer ("DekantPM Protocol — Devnet")
- `app/layout.tsx`: Assemble Navbar + main content area + Footer
- Navigation links use Next.js `<Link>`, active state styling
- Admin and Oracle links only visible if user has the corresponding role (check via on-chain PDA or backend; for MVP, always show but gate the page content)

**Depends on:** F-2

---

### F-4: Market Discovery Page ✅

**Goal:** Build the main markets list page with filtering and search.

**Deliverable — `app/markets/page.tsx`:**
- TanStack Query hook: `useMarkets(filters)` → calls `GET /markets`
- Filter bar: category dropdown, market type tabs (All / Binary / Multi / Continuous), state filter (Active / Resolved), sort (Newest / Deadline / Volume)
- Search input (debounced text search)
- Grid of `MarketCard` components

**Deliverable — `components/market/MarketCard.tsx`:**
- Card with: title, category badge, market type badge, deadline (relative: "3 days left"), status badge
- For binary: horizontal probability bar (Yes% / No%)
- For multi: top outcome with its probability
- For continuous: mini sparkline or "Market price: $X" summary
- Click → navigates to `/markets/[id]`

**Deliverable — `components/market/MarketStatus.tsx`:**
- Badge component: Active (green), Paused (yellow), Pending Resolution (orange), Resolved (blue)

**Depends on:** F-3, B-5

---

### F-5: Market Detail Page — Info & Chart ✅

**Goal:** Build the market detail page showing market info and current probability distribution.

**Deliverable — `app/markets/[id]/page.tsx`:**
- TanStack Query: `useMarket(id)` → calls `GET /markets/:id` + RPC `getAccountInfo(marketPDA)` for live reserves
- Layout: two-column on desktop (chart/info left, trading panel right)
- Market info section: title, full description, category, deadline, oracle address, collateral token, status
- Price/probability section:
  - Binary: large percentage display ("Yes: 62% / No: 38%") + horizontal bar
  - Multi: vertical bar chart of all outcome probabilities with labels
  - Continuous: `DistributionChart` showing the market-implied PDF

**Deliverable — `components/market/DistributionChart.tsx`:**
- SVG chart (Visx or Recharts) rendering the market-implied distribution
- X-axis: range [min, max] with labels
- Y-axis: probability density
- Curve: filled area chart of `reserves[i]² / k_squared` per bin
- Hover tooltip: "Bin $170–$175: 4.2% probability"

**Deliverable — `components/market/PriceBar.tsx`:**
- Horizontal stacked bar for binary/multi outcomes with percentage labels

**Depends on:** F-4

---

### F-6: Trading Panel — Binary & Multi-Outcome Input ✅

**Goal:** Build the trading input components for discrete markets.

**Deliverable — `components/trading/TradingPanel.tsx`:**
- Container component that renders the correct input based on `market.market_type`
- Sections: Input → Cost Preview → Action Button
- Buy/Sell toggle tabs

**Deliverable — `components/trading/BinaryInput.tsx`:**
- Single slider (0%–100%) for "probability of Yes"
- Numeric input for collateral amount (USDC)
- Labels: "You think Yes is more likely" / "You think No is more likely"

**Deliverable — `components/trading/MultiOutcomeInput.tsx`:**
- Individual slider for each outcome (0%–100%)
- Visual indicator when allocations don't sum to 100%
- Numeric input for collateral amount

**Deliverable — `components/trading/CostPreview.tsx`:**
- Calls `POST /amm/estimate-buy` (or estimate-sell) on every input change (debounced 200ms)
- Displays: tokens out, trade fee, total cost, potential max payout
- Loading state while estimation is in-flight

**Depends on:** F-5, B-7

---

### F-7: Trading Panel — Distribution Input (Continuous) ✅

**Goal:** Build the distribution input UX for continuous markets — the core UX innovation.

**Deliverable — `components/trading/DistributionInput.tsx`:**
- **Center input:** numeric text field + slider (range: [market.range_min, market.range_max])
- **Confidence input:** slider with labels "Very sure" ← → "Very uncertain"
  - Maps to σ via log scale: `σ = range_width * exp(lerp(ln(1/100), ln(1/2), slider_value))`
  - Display below: "±$X covers 68% of your prediction"
- **Preview chart:** overlay the trader's distribution (blue filled) on top of the market's current distribution (gray dashed) using `DistributionChart`
- **Collateral input:** numeric field for stake amount
- **Cost preview:** integrated CostPreview component showing estimated cost, max payout at center, break-even range

**Deliverable — `lib/normal.ts`:**
- TypeScript Normal PDF computation for bin weight preview (mirrors backend `amm/normal.ts`)
- `computeBinWeights(rangeMin, rangeMax, numBins, mu, sigma) -> number[]`

**Tests (manual):**
- Move center slider → blue curve moves
- Adjust confidence → curve widens/narrows
- Cost preview updates in real-time
- Overlaid on market distribution → visual comparison clear

**Depends on:** F-6

---

### F-8: Trade Execution & Transaction Flow

**Goal:** Wire up the "Place Trade" button to build, sign, and submit Solana transactions.

**Deliverable — `lib/transactions.ts`:**
- `buildBuyTransaction(program, market, outcome, amount)` → `VersionedTransaction`
- `buildSellTransaction(program, market, outcome, tokenAmount)` → `VersionedTransaction`
- `buildDistributionBuyTransaction(program, market, mu, sigma, amount)` → `VersionedTransaction`
- `buildDistributionSellTransaction(program, market, mu, sigma, tokenAmount)` → `VersionedTransaction`
- Each function: derives all required PDAs, builds the Anchor instruction, adds ComputeBudget if needed, creates versioned transaction
- Helper: `sendAndConfirmTransaction(connection, wallet, tx)` → signature string

**Deliverable — `components/trading/TradingPanel.tsx` (update):**
- "Place Trade" button calls the appropriate build function
- Wallet signs the transaction
- Shows toast on success/failure
- On success: invalidate TanStack Query cache for market + positions
- Loading state during signing + confirmation

**Deliverable — `components/common/TransactionToast.tsx`:**
- Success: "Trade placed! View on Solscan" (link to tx)
- Error: parsed error message (map Anchor error codes to human-readable)

**Depends on:** F-7

---

### F-9: Portfolio Page

**Goal:** Build the page showing all of a user's positions.

**Deliverable — `app/portfolio/page.tsx`:**
- Guard: requires wallet connected
- TanStack Query: `useUserPositions(walletAddress)` → calls `GET /users/:address/positions` or reads UserPosition PDAs via RPC
- Grid of `PositionCard` components grouped by: Active Markets / Resolved (claimable) / Past (claimed)

**Deliverable — `components/portfolio/PositionCard.tsx`:**
- Market title, type badge, status badge
- Holdings summary:
  - Binary: "You hold X Yes tokens, Y No tokens"
  - Multi: list of holdings per outcome
  - Continuous: mini distribution chart of user's holdings
- Cost basis: total deposited vs current value (mark-to-market using current prices)
- Unrealized PnL
- For resolved markets: "Claim" button if not yet claimed

**Deliverable — `components/portfolio/ClaimButton.tsx`:**
- Builds and sends `claim_payout` transaction
- Shows payout amount before confirming
- Toast on success with amount claimed

**Depends on:** F-8

---

### F-10: Admin Dashboard

**Goal:** Build the admin panel for role management, fee config, and market controls.

**Deliverable — `app/admin/page.tsx`:**
- Guard: check if connected wallet has Admin or Superadmin role (read UserRole PDA)
- If not authorized: show "Access denied" message
- Sections: Roles | Fees | Market Controls

**Deliverable — `components/admin/RoleManager.tsx`:**
- List current roles (from `GET /admin/roles`)
- Form: assign role (wallet address input, role dropdown, submit button)
- Each role row: wallet, role, assigned_by, "Revoke" button
- Assign/Revoke build and send the corresponding Anchor transactions

**Deliverable — `components/admin/FeeConfig.tsx`:**
- Current fee values displayed (from ProtocolConfig PDA)
- Input fields for each fee (creation, trade, redemption, LP share) in bps
- "Update Fees" button → builds and sends `update_fees` transaction
- Only visible to Superadmin

**Deliverable — `components/admin/PauseControls.tsx`:**
- Per-market pause/unpause buttons (in market detail or admin list)
- Button state reflects current market state

**Depends on:** F-3, F-8

---

### F-11: Market Creation Form

**Goal:** Build the multi-step form for creating a new market.

**Deliverable — `app/admin/create-market/page.tsx`:**
- Guard: Creator, Admin, or Superadmin role required
- Multi-step form (React Hook Form + Zod validation):
  1. **Type selection:** Binary / Multi-Outcome / Continuous (card selector)
  2. **Question details:** Title, Description, Category (dropdown), Tags (multi-input)
  3. **Outcomes:**
     - Binary: no extra input (auto: Yes/No)
     - Multi: dynamic outcome list (add/remove, 3–32 labels)
     - Continuous: range_min, range_max, num_bins (slider: 64/128/256)
  4. **Parameters:** Deadline (date picker), Oracle (wallet address input with validation that they have Oracle role), Collateral token (USDC/USDT selector), Initial liquidity amount
  5. **Review & Confirm:** summary of all inputs, estimated creation fee, "Create Market" button

- On submit:
  1. Send `POST /markets` to backend (store metadata: title, description, category, tags, outcome_labels)
  2. Build and send `create_market` Anchor transaction
  3. On success: redirect to new market page

**Depends on:** F-10

---

### F-12: Oracle Dashboard

**Goal:** Build the oracle's view for resolving markets.

**Deliverable — `app/oracle/page.tsx`:**
- Guard: check Oracle role
- List of markets assigned to this oracle, filtered to PendingResolution state
- Uses `GET /admin/markets/stale` or filters from `GET /markets?oracle=<address>&state=2`

**Deliverable — `components/oracle/ResolveForm.tsx`:**
- Per-market resolution form:
  - Binary: two buttons "Resolve as Yes" / "Resolve as No"
  - Multi: dropdown selector with outcome labels
  - Continuous: numeric input for exact resolved value (within [range_min, range_max])
- Confirmation dialog: "Are you sure? This cannot be undone."
- Builds and sends `resolve_market` transaction
- Toast on success

**Depends on:** F-3, F-8

---

### F-13: End-to-End Smoke Test

**Goal:** Verify the entire stack works together (program + backend + frontend) on local validator.

**Deliverable — `scripts/e2e-smoke.sh` or manual test script:**
1. Start local validator + PostgreSQL
2. Deploy program
3. Initialize protocol (via CLI script or test)
4. Start backend (connects to local validator)
5. Start frontend (connects to local backend + validator)
6. **Manual test flow:**
   - Connect wallet (devnet-funded)
   - Admin: assign Creator and Oracle roles
   - Creator: create a binary market ("Will SOL hit $200 this month?", deadline in 5 minutes)
   - Verify market appears on market discovery page
   - Trader 1: buy "Yes" with 10 USDC → see price move, position in portfolio
   - Trader 2: buy "No" with 5 USDC → see price rebalance
   - Wait for deadline (or set to 1 minute)
   - Oracle: resolve as "Yes"
   - Trader 1: claim payout → see USDC in wallet
   - Verify: market shows "Resolved", correct outcome displayed
7. **Repeat for continuous market:**
   - Create continuous market, range $50–$500, 64 bins
   - Buy distribution with center=$180, confidence=medium
   - Resolve with value=$175
   - Claim payout

**Depends on:** F-12, B-8

---

### F-14: Continuous Market Sell Trading UI

**Goal:** Wire up the sell tab for continuous markets using distribution sell estimation from B-9.

**Deliverable — `components/trading/TradingPanel.tsx` (update):**
- Replace `SellUnavailable` placeholder with `DistributionInput` for sell mode
- Pass mu/sigma to `CostPreview` with side="sell" for distribution sell estimation
- Display: shares to sell input, estimated USDC received, fee

**Deliverable — `components/trading/CostPreview.tsx` (update):**
- Handle distribution sell response: `{ collateralOut, fee, newProbabilities }`
- Send mu/sigma to `POST /amm/estimate-sell` (same pattern as distribution buy)

**Tests (manual):**
- Select sell tab on continuous market → distribution input appears
- Enter shares to sell → cost preview shows estimated USDC received
- Fee displayed correctly

**Depends on:** F-7, B-9

---

## Devkit Tasks (Program Interaction Scripts)

> **Directory:** `devkit/`
> **Purpose:** Standalone TypeScript scripts for interacting directly with the on-chain program without using the backend or frontend. Useful for development, testing, demos, and operations.
> **Reuses:** `tests/helpers/` (context, PDA derivation, accounts, constants) and `target/idl/dekant_pm.json`.

### S-1: Devkit Scaffolding & Protocol Setup Script

**Goal:** Set up the devkit directory structure and a script for protocol initialization + role assignment.

**Deliverable — `devkit/`:**
- `package.json` — dependencies: `@coral-xyz/anchor`, `@solana/web3.js`, `@solana/spl-token`, `bn.js`, `dotenv`, `commander`
- `tsconfig.json` — TS config for scripts (ESM or CommonJS, matching root)
- `.env.example` — `RPC_URL`, `PROGRAM_ID`, `KEYPAIR_PATH` (defaults to `~/.config/solana/id.json`)
- `src/common.ts` — shared setup: load keypair, create connection, load IDL, derive PDAs (adapt from `tests/helpers/`)
- `src/setup.ts` — CLI script:
  - `setup init` — Initialize protocol (calls `initialize` instruction)
  - `setup assign-role <wallet> <role>` — Assign Admin/Oracle/Creator role
  - `setup revoke-role <wallet> <role>` — Revoke a role
  - `setup update-fees <creation> <trade> <redemption> <lp-share>` — Update protocol fees (bps)
  - `setup collect-fees <market-id>` — Sweep fees to treasury
  - Each subcommand: derives PDAs, builds tx, signs with loaded keypair, confirms, logs result

**Depends on:** P-19 (program must be built)

---

### S-2: Market Management Scripts

**Goal:** Scripts for creating, pausing, unpausing, and inspecting markets.

**Deliverable — `devkit/src/market.ts`:**
- `market create-binary <title> <oracle> <liquidity> <deadline>` — Create a binary market
- `market create-multi <title> <oracle> <liquidity> <deadline> <outcomes...>` — Create multi-outcome market with named outcomes
- `market create-continuous <title> <oracle> <liquidity> <deadline> <range-min> <range-max> [--bins N]` — Create continuous market
  - Automatically converts range values to SCALE-denominated i64
  - Default bins: 64
- `market pause <market-id>` — Pause an active market
- `market unpause <market-id>` — Unpause a paused market
- `market info <market-id>` — Fetch and display market state (reserves, prices, status, deadline)
  - Pretty-prints current probabilities, total volume, traders, range info for continuous

**Notes:**
- Title/description/category stored off-chain (backend) — these scripts only interact with the program. Title is passed as informational output only.
- All scripts create the collateral mint and necessary ATAs if they don't exist (or accept `--mint <address>`)
- Deadline can be relative (`+1h`, `+7d`) or absolute ISO 8601

**Depends on:** S-1

---

### S-3: Trading Scripts

**Goal:** Scripts for executing all trade types directly against the program.

**Deliverable — `devkit/src/trade.ts`:**
- `trade buy <market-id> <outcome> <amount>` — Discrete buy (binary/multi)
- `trade sell <market-id> <outcome> <amount>` — Discrete sell (binary/multi)
- `trade buy-dist <market-id> <mu> <sigma> <amount>` — Distribution buy (continuous)
  - Converts mu/sigma to SCALE-denominated i64/u64 before sending
- `trade sell-dist <market-id> <mu> <sigma> <amount>` — Distribution sell (continuous)
- `trade buy-to-price <market-id> <outcome> <target-prob>` — Buy to target probability
- `trade sell-to-price <market-id> <outcome> <target-prob>` — Sell to target probability
- `trade add-lp <market-id> <amount>` — Add liquidity
- `trade remove-lp <market-id> <shares>` — Remove liquidity

**Common behavior:**
- Each command: fetches current market state, derives PDAs, builds instruction, signs, confirms
- Prints: before/after probabilities, tokens received/sent, fees paid
- Amount is human-readable (e.g., "10" = 10 USDC), script converts to raw (×10^6)

**Depends on:** S-2

---

### S-4: Resolution & Settlement Scripts

**Goal:** Scripts for resolving markets and claiming payouts.

**Deliverable — `devkit/src/resolve.ts`:**
- `resolve market <market-id> <outcome>` — Resolve binary/multi market (signer must be oracle)
- `resolve market <market-id> --value <number>` — Resolve continuous market with exact value
  - Converts value to SCALE-denominated i64
- `resolve claim <market-id>` — Claim payout from resolved market
- `resolve info <market-id>` — Show resolution details (resolved outcome, winning bin, vault balance)

**Depends on:** S-3

---

## Summary: Task Count & Ordering

| Layer | Tasks | IDs | Status |
|-------|-------|-----|--------|
| Infrastructure | 3 | I-1 → I-3 | ✅ Done |
| On-chain Program | 19 | P-1 → P-19 | ✅ Done |
| Backend | 9 | B-1 → B-9 | ⬅️ B-1→B-8 done, B-9 next |
| Frontend | 14 | F-1 → F-14 | ⬅️ F-1→F-7 done, F-8 next |
| Devkit | 4 | S-1 → S-4 | ✅ Done |
| **Total** | **49** | | |

### Critical Path (longest dependency chain):

```
I-1 → I-2 → I-3 → P-1 → P-2 → P-5 → P-9 → P-10 → P-12 → P-17 → P-18 → P-19 → B-3 → B-6 → B-8 → F-2 → F-5 → F-7 → F-8 → F-13
```

### Parallelization Opportunities:

Once P-1 is done, these can proceed in parallel:
- P-2 (math lib) and P-4 (state structs) — no dependency on each other
- P-3 (normal PDF) can start as soon as P-2 is done

Once P-9 (create_market) is done:
- P-10 (buy), P-14 (liquidity), P-15 (pause/unpause) — can all proceed in parallel

Backend and frontend can start scaffolding (B-1, F-1) in parallel with program work, but substantive backend work (B-3+) needs the built IDL from program compilation.

Frontend discovery (F-4) and admin (F-10) can proceed in parallel once F-3 is done.

Devkit (S-1→S-4) can proceed independently of frontend/backend — only requires the built program (P-19 done). Can run in parallel with F-8+ and B-9.
