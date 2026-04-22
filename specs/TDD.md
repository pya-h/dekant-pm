# DekantPM Prediction Market — Technical Design Document

**Version:** 1.0
**Date:** 2026-02-23
**Status:** Draft
**Companion to:** PRD v1.0

---

## Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [On-Chain Program Architecture](#2-on-chain-program-architecture)
3. [Account Model Design](#3-account-model-design)
4. [PDA Layout Strategy](#4-pda-layout-strategy)
5. [AMM Mathematics & Engine](#5-amm-mathematics--engine)
6. [State Transition Logic](#6-state-transition-logic)
7. [Oracle Integration Design](#7-oracle-integration-design)
8. [Off-Chain Services](#8-off-chain-services)
9. [Backend Indexing Architecture](#9-backend-indexing-architecture)
10. [Frontend Architecture](#10-frontend-architecture)
11. [Failure Modes & Attack Surfaces](#11-failure-modes--attack-surfaces)
12. [Appendix A: Fixed-Point Arithmetic Spec](#appendix-a-fixed-point-arithmetic-spec)
13. [Appendix B: CU Budget Analysis](#appendix-b-cu-budget-analysis)
14. [Appendix C: Account Sizing Tables](#appendix-c-account-sizing-tables)

---

## 1. System Architecture Overview

```
┌───────────────────────────────────────────────────────────────────┐
│                          CLIENTS                                  │
│                                                                   │
│  ┌─────────────────────────┐     ┌────────────────────────────┐   │
│  │    Next.js Frontend     │     │   Admin / Oracle Clients   │   │
│  │  (Wallet, Trading UI,   │     │  (Role mgmt, Resolution)  │   │
│  │   Distribution Input)   │     │                            │   │
│  └──────────┬──────────────┘     └─────────────┬──────────────┘   │
└─────────────┼──────────────────────────────────┼──────────────────┘
              │                                  │
              │  HTTP/WS                         │  HTTP/WS
              ▼                                  ▼
┌───────────────────────────────────────────────────────────────────┐
│                      BACKEND (NestJS)                             │
│                                                                   │
│  ┌──────────┐ ┌────────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │ Market   │ │ Indexer    │ │ Auth     │ │ Cost Estimator   │   │
│  │ Service  │ │ Service    │ │ Service  │ │ (off-chain AMM   │   │
│  │          │ │            │ │ (wallet  │ │  simulation)     │   │
│  │          │ │            │ │  sig)    │ │                  │   │
│  └──────────┘ └─────┬──────┘ └──────────┘ └──────────────────┘   │
│                     │                                             │
│           ┌─────────┴─────────┐                                   │
│           │   PostgreSQL DB   │                                   │
│           └───────────────────┘                                   │
└──────────────────────┬────────────────────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          │ Solana RPC │            │ Direct RPC from frontend
          │ (read/     │            │ for tx signing & submission
          │  subscribe)│            │
          ▼            │            ▼
┌───────────────────────────────────────────────────────────────────┐
│                    SOLANA RUNTIME                                  │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │              DekantPM Program (Anchor / Rust)                 │   │
│  │                                                            │   │
│  │  Instructions:                                             │   │
│  │  ┌──────────────┐ ┌──────────────┐ ┌────────────────────┐ │   │
│  │  │ Admin        │ │ Market       │ │ Trading            │ │   │
│  │  │              │ │              │ │                    │ │   │
│  │  │ initialize   │ │ create_      │ │ buy                │ │   │
│  │  │ assign_role  │ │   market     │ │ sell               │ │   │
│  │  │ revoke_role  │ │ pause_market │ │ add_liquidity      │ │   │
│  │  │ update_fees  │ │ unpause_     │ │ remove_liquidity   │ │   │
│  │  │              │ │   market     │ │ claim_payout       │ │   │
│  │  │              │ │ resolve_     │ │                    │ │   │
│  │  │              │ │   market     │ │                    │ │   │
│  │  └──────────────┘ └──────────────┘ └────────────────────┘ │   │
│  │                                                            │   │
│  │  AMM Engine (lib):                                         │   │
│  │  ┌────────────────────────────────────────────────────┐    │   │
│  │  │ L2-norm CFAMM                                      │    │   │
│  │  │ - compute_buy_cost(reserves, outcome, amount)      │    │   │
│  │  │ - compute_sell_return(reserves, outcome, amount)    │    │   │
│  │  │ - compute_distribution_buy(reserves, weights, amt) │    │   │
│  │  │ - compute_distribution_sell(reserves, weights, amt)│    │   │
│  │  │ - verify_invariant(reserves, k_squared)            │    │   │
│  │  │ - compute_implied_probabilities(reserves)          │    │   │
│  │  └────────────────────────────────────────────────────┘    │   │
│  │                                                            │   │
│  │  Math lib:                                                 │   │
│  │  ┌────────────────────────────────────────────────────┐    │   │
│  │  │ fixed_point.rs — u128 scaled arithmetic            │    │   │
│  │  │ sqrt.rs — integer Newton's method                  │    │   │
│  │  │ normal_pdf.rs — Gaussian bin weight computation    │    │   │
│  │  └────────────────────────────────────────────────────┘    │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                                                   │
│  Accounts (PDAs):                                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ Protocol │ │ UserRole │ │ Market   │ │ User     │            │
│  │ Config   │ │          │ │ + Vault  │ │ Position │            │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘            │
│                                         ┌──────────┐            │
│                                         │ LP       │            │
│                                         │ Position │            │
│                                         └──────────┘            │
└───────────────────────────────────────────────────────────────────┘
```

### Data Flow Principles

1. **All financial state lives on-chain.** The program is the single source of truth for reserves, positions, balances, and market lifecycle state.
2. **Backend is a read cache + metadata store.** It indexes on-chain events and stores supplementary data (descriptions, categories, tags) that doesn't belong on-chain. A compromised backend cannot affect funds.
3. **Frontend reads from backend for discovery, reads from RPC for critical state, writes directly to the program** via wallet-signed transactions.
4. **Transactions are built client-side** (frontend or CLI), signed by the user's wallet, and submitted to Solana RPC. The backend never holds private keys.

---

## 2. On-Chain Program Architecture

### 2.1 Module Structure

```
programs/dekant-pm/
├── src/
│   ├── lib.rs                    # Program entry, declare_id, module registration
│   ├── errors.rs                 # Custom error codes (DekantPmError enum)
│   ├── constants.rs              # Seed prefixes, scale factors, limits
│   │
│   ├── state/                    # Account structs (Anchor #[account])
│   │   ├── mod.rs
│   │   ├── protocol_config.rs    # ProtocolConfig
│   │   ├── user_role.rs          # UserRole
│   │   ├── market.rs             # Market (unified for all types)
│   │   ├── user_position.rs      # UserPosition
│   │   └── lp_position.rs        # LpPosition
│   │
│   ├── instructions/             # Instruction handlers
│   │   ├── mod.rs
│   │   ├── admin/
│   │   │   ├── initialize.rs     # One-time protocol setup
│   │   │   ├── assign_role.rs    # Grant role to wallet
│   │   │   ├── revoke_role.rs    # Remove role from wallet
│   │   │   └── update_fees.rs    # Change fee parameters
│   │   ├── market/
│   │   │   ├── create_market.rs  # Create + seed initial liquidity
│   │   │   ├── pause_market.rs   # Freeze trading
│   │   │   ├── unpause_market.rs # Resume trading
│   │   │   └── resolve_market.rs # Oracle submits outcome
│   │   └── trading/
│   │       ├── buy.rs            # Buy outcome tokens (discrete)
│   │       ├── sell.rs           # Sell outcome tokens (discrete)
│   │       ├── buy_distribution.rs   # Buy via distribution params (continuous)
│   │       ├── sell_distribution.rs  # Sell via distribution params (continuous)
│   │       ├── add_liquidity.rs      # Proportional LP deposit
│   │       ├── remove_liquidity.rs   # Proportional LP withdrawal
│   │       └── claim_payout.rs       # Redeem winning tokens post-resolution
│   │
│   └── engine/                   # Pure computation (no Anchor context)
│       ├── mod.rs
│       ├── amm.rs                # L2-norm AMM core logic
│       ├── fixed_point.rs        # u128 scaled math primitives
│       ├── sqrt.rs               # Integer square root (Newton's method)
│       └── normal_pdf.rs         # Gaussian discretization into bins
```

### 2.2 Instruction Set

| Instruction | Signer | Key Accounts | Description |
|-------------|--------|--------------|-------------|
| `initialize` | Superadmin (deployer) | `ProtocolConfig` (init) | One-time. Sets superadmin, treasury, initial fees. |
| `assign_role` | Admin+ | `UserRole` (init), `ProtocolConfig` | Creates a UserRole PDA for target wallet. |
| `revoke_role` | Admin+ | `UserRole` (close) | Closes UserRole PDA, reclaims rent. |
| `update_fees` | Superadmin | `ProtocolConfig` (mut) | Updates fee basis points. |
| `create_market` | Creator+ | `Market` (init), `MarketVault` (init), creator's token ATA | Creates market, transfers initial liquidity. |
| `pause_market` | Admin+ | `Market` (mut) | Sets state to Paused. |
| `unpause_market` | Admin+ | `Market` (mut) | Sets state back to Active (only if deadline not passed). |
| `resolve_market` | Oracle (assigned) | `Market` (mut) | Records outcome. Sets state to Resolved. |
| `buy` | Trader | `Market` (mut), `UserPosition` (init_if_needed), `MarketVault`, trader ATA | Discrete: buy tokens of one outcome. |
| `sell` | Trader | `Market` (mut), `UserPosition` (mut), `MarketVault`, trader ATA | Discrete: sell tokens of one outcome. |
| `buy_distribution` | Trader | `Market` (mut), `UserPosition` (init_if_needed), `MarketVault`, trader ATA | Continuous: buy via (μ, σ, stake). |
| `sell_distribution` | Trader | `Market` (mut), `UserPosition` (mut), `MarketVault`, trader ATA | Continuous: sell proportional to (μ, σ, amount). |
| `add_liquidity` | LP | `Market` (mut), `LpPosition` (init_if_needed), `MarketVault`, LP ATA | Deposit proportional liquidity. |
| `remove_liquidity` | LP | `Market` (mut), `LpPosition` (mut), `MarketVault`, LP ATA | Withdraw proportional liquidity. |
| `claim_payout` | Trader | `Market`, `UserPosition` (mut), `MarketVault`, trader ATA | Redeem winning tokens for collateral. |

### 2.3 Privilege Escalation Rules

```
Instruction            Required Role
─────────────────────  ──────────────────────────────────
initialize             deployer keypair (checked vs hardcoded pubkey)
assign_role            Superadmin (for Admin, Oracle, Creator)
                       Admin      (for Oracle, Creator only)
revoke_role            same as assign_role
update_fees            Superadmin only
create_market          Creator OR Admin OR Superadmin
pause_market           Admin OR Superadmin
unpause_market         Admin OR Superadmin
resolve_market         Oracle (must match market.oracle field)
buy / sell / buy_dist  any wallet (Trader = default)
sell_dist / claim      any wallet
add/remove_liquidity   any wallet
```

Role checks are performed by:
1. Deriving the expected UserRole PDA for (signer, role).
2. Attempting to deserialize. If the account exists and is valid → authorized.
3. For Superadmin: additionally check `signer == protocol_config.superadmin`.
4. For Admin+: check if signer is admin OR superadmin.

---

## 3. Account Model Design

### 3.1 ProtocolConfig

```
Seeds: ["protocol_config"]
Unique: singleton (one per program deployment)

┌─────────────────────────────────────────────────────┐
│ ProtocolConfig                                       │
├──────────────────────┬──────────┬────────────────────┤
│ Field                │ Type     │ Description        │
├──────────────────────┼──────────┼────────────────────┤
│ version              │ u8       │ Schema version (1) │
│ superadmin           │ Pubkey   │ Superadmin wallet  │
│ treasury             │ Pubkey   │ Fee destination    │
│ market_count         │ u64      │ Auto-increment ID  │
│ creation_fee_bps     │ u16      │ Market creation fee│
│ trade_fee_bps        │ u16      │ Per-trade fee      │
│ redemption_fee_bps   │ u16      │ Payout claim fee   │
│ lp_fee_share_bps     │ u16      │ LP share of trade  │
│                      │          │ fee (rest→treasury)│
│ bump                 │ u8       │ PDA bump seed      │
│ _padding             │ [u8; 64] │ Future fields      │
├──────────────────────┴──────────┴────────────────────┤
│ Size: 8 (discriminator) + 1 + 32 + 32 + 8 +         │
│       2 + 2 + 2 + 2 + 1 + 64 = 154 bytes            │
└──────────────────────────────────────────────────────┘
```

### 3.2 UserRole

```
Seeds: ["user_role", user_pubkey, role_type (u8)]
Unique: one per (user, role) pair

┌─────────────────────────────────────────────────────┐
│ UserRole                                             │
├──────────────────────┬──────────┬────────────────────┤
│ Field                │ Type     │ Description        │
├──────────────────────┼──────────┼────────────────────┤
│ version              │ u8       │ Schema version     │
│ user                 │ Pubkey   │ Wallet address     │
│ role                 │ u8       │ Enum: 1=Admin,     │
│                      │          │ 2=Oracle, 3=Creator│
│ assigned_by          │ Pubkey   │ Who granted it     │
│ assigned_at          │ i64      │ Unix timestamp     │
│ bump                 │ u8       │ PDA bump seed      │
├──────────────────────┴──────────┴────────────────────┤
│ Size: 8 + 1 + 32 + 1 + 32 + 8 + 1 = 83 bytes       │
└──────────────────────────────────────────────────────┘
```

### 3.3 Market

The Market account is the most complex. It stores AMM state (reserves), market metadata, and lifecycle state. Because continuous markets need up to 256 bins, the reserves array is variable-length.

```
Seeds: ["market", market_id (u64 as le_bytes)]
Unique: one per market

┌──────────────────────────────────────────────────────────────────┐
│ Market                                                            │
├──────────────────────────┬──────────┬─────────────────────────────┤
│ Field                    │ Type     │ Description                 │
├──────────────────────────┼──────────┼─────────────────────────────┤
│ version                  │ u8       │ Schema version              │
│ market_id                │ u64      │ Auto-incremented ID         │
│ market_type              │ u8       │ 0=Binary, 1=Multi, 2=Cont  │
│ state                    │ u8       │ Lifecycle state enum        │
│ creator                  │ Pubkey   │ Who created this market     │
│ oracle                   │ Pubkey   │ Assigned oracle wallet      │
│ collateral_mint          │ Pubkey   │ SPL token mint (USDC/USDT)  │
│ vault                    │ Pubkey   │ Token vault PDA address     │
│ deadline                 │ i64      │ Unix timestamp              │
│ created_at               │ i64      │ Unix timestamp              │
│ resolved_at              │ i64      │ 0 until resolved            │
│                          │          │                             │
│ // AMM Parameters                                                 │
│ num_outcomes             │ u16      │ N (binary=2, multi≤32,      │
│                          │          │ cont=num_bins)              │
│ k_squared                │ u128     │ ||reserves||₂² (invariant)  │
│ total_minted             │ u128     │ Complete sets outstanding    │
│ lp_shares_total          │ u128     │ Total LP shares minted      │
│ lp_fee_accumulated       │ u128     │ Unclaimed LP fees           │
│                          │          │                             │
│ // Continuous-specific                                            │
│ range_min                │ i64      │ Min value (scaled 10^9)     │
│ range_max                │ i64      │ Max value (scaled 10^9)     │
│                          │          │                             │
│ // Resolution                                                     │
│ resolved_outcome         │ u16      │ Winning index (disc) or     │
│                          │          │ winning bin (cont)          │
│ resolved_value           │ i64      │ Exact value (continuous)    │
│                          │          │                             │
│ // Outcome labels (discrete only, stored as indices into          │
│ //   off-chain metadata — not stored on-chain)                    │
│                          │          │                             │
│ bump                     │ u8       │ PDA bump                    │
│ _padding                 │ [u8;32]  │ Future fields               │
│                          │          │                             │
│ // Variable-length AMM reserves                                   │
│ reserves                 │ [u64; N] │ AMM holdings per outcome/bin│
├──────────────────────────┴──────────┴─────────────────────────────┤
│ Fixed header: 8 + 1+8+1+1 + 32+32+32+32 + 8+8+8 +               │
│               2+16+16+16+16 + 8+8 + 2+8 + 1+32 = 288 bytes      │
│ Reserves: N * 8 bytes                                             │
│ Total: 288 + N*8                                                  │
│   Binary (N=2):    304 bytes                                      │
│   Multi (N=32):    544 bytes                                      │
│   Continuous (N=64):  800 bytes                                   │
│   Continuous (N=128): 1,312 bytes                                 │
│   Continuous (N=256): 2,336 bytes                                 │
└──────────────────────────────────────────────────────────────────┘
```

**Design note — why a single Market struct?**
Binary and multi-outcome markets are degenerate cases of the continuous market (just fewer bins, no range). Using a single struct avoids code duplication in AMM logic. The `market_type` field determines which instruction variants are valid and how resolution/display works.

### 3.4 UserPosition

```
Seeds: ["user_position", market_pubkey, user_pubkey]
Unique: one per (market, user) pair

┌──────────────────────────────────────────────────────────────────┐
│ UserPosition                                                      │
├──────────────────────────┬──────────┬─────────────────────────────┤
│ Field                    │ Type     │ Description                 │
├──────────────────────────┼──────────┼─────────────────────────────┤
│ version                  │ u8       │ Schema version              │
│ market                   │ Pubkey   │ Market PDA address          │
│ user                     │ Pubkey   │ Trader wallet               │
│ total_deposited          │ u64      │ Cumulative collateral in    │
│ total_withdrawn          │ u64      │ Cumulative collateral out   │
│ claimed                  │ bool     │ Has claimed payout?         │
│ bump                     │ u8       │ PDA bump                    │
│ _padding                 │ [u8;16]  │ Future fields               │
│                          │          │                             │
│ // Variable-length holdings                                       │
│ holdings                 │ [u64; N] │ Tokens held per outcome/bin │
├──────────────────────────┴──────────┴─────────────────────────────┤
│ Fixed header: 8 + 1 + 32 + 32 + 8 + 8 + 1 + 1 + 16 = 107 bytes │
│ Holdings: N * 8 bytes                                             │
│ Total: 107 + N*8                                                  │
│   Binary:     123 bytes                                           │
│   Multi-32:   363 bytes                                           │
│   Cont-256:   2,155 bytes                                         │
└──────────────────────────────────────────────────────────────────┘
```

### 3.5 LpPosition

```
Seeds: ["lp_position", market_pubkey, user_pubkey]
Unique: one per (market, LP) pair

┌──────────────────────────────────────────────────────────────────┐
│ LpPosition                                                        │
├──────────────────────────┬──────────┬─────────────────────────────┤
│ Field                    │ Type     │ Description                 │
├──────────────────────────┼──────────┼─────────────────────────────┤
│ version                  │ u8       │ Schema version              │
│ market                   │ Pubkey   │ Market PDA address          │
│ user                     │ Pubkey   │ LP wallet                   │
│ shares                   │ u128     │ LP shares held              │
│ deposited_collateral     │ u64      │ Total collateral deposited  │
│ bump                     │ u8       │ PDA bump                    │
│ _padding                 │ [u8;16]  │ Future fields               │
├──────────────────────────┴──────────┴─────────────────────────────┤
│ Size: 8 + 1 + 32 + 32 + 16 + 8 + 1 + 16 = 114 bytes            │
└──────────────────────────────────────────────────────────────────┘
```

### 3.6 MarketVault

Not a custom account struct — this is a standard SPL Token Account whose authority is a PDA.

```
Seeds (for vault authority): ["vault_authority", market_pubkey]
The actual vault is an Associated Token Account owned by this authority PDA.
```

---

## 4. PDA Layout Strategy

### 4.1 Seed Derivation Table

| Account | Seeds | Bump | Notes |
|---------|-------|------|-------|
| `ProtocolConfig` | `["protocol_config"]` | stored | Singleton. Found by any client without parameters. |
| `UserRole` | `["user_role", user: Pubkey, role: u8]` | stored | Role enum encoded as u8. A wallet can have multiple roles (separate PDAs). Closing the PDA = revoking the role. |
| `Market` | `["market", market_id: u64.to_le_bytes()]` | stored | Market ID from ProtocolConfig.market_count (auto-increment). Deterministic: given the ID, any client can derive the address. |
| `VaultAuthority` | `["vault_authority", market: Pubkey]` | stored in Market | PDA that owns the SPL token vault. Signs CPI transfers. |
| `UserPosition` | `["user_position", market: Pubkey, user: Pubkey]` | stored | Created on first trade. Closed on claim (optional, to reclaim rent). |
| `LpPosition` | `["lp_position", market: Pubkey, user: Pubkey]` | stored | Created on first LP deposit. Closed on full withdrawal. |

### 4.2 Design Decisions

**Why encode role as a seed (not a bitfield)?**
- A bitfield in a single UserRole PDA would require updating the PDA to add/remove roles (mutable write, signer checks).
- Separate PDAs per role: assigning a role = creating a PDA (init), revoking = closing it (close). No mutation needed. Existence check is the authorization check.
- Tradeoff: a wallet with 3 roles has 3 PDAs (3 × ~83 bytes rent). Acceptable for MVP since privileged roles are few.

**Why store bump in every PDA?**
- Avoids recomputing `find_program_address` in every instruction (saves ~2,000 CU per PDA access).
- Bumps are validated on init and never change.

**Why u64 market IDs (not UUIDs or hashes)?**
- Compact: 8 bytes vs 16 (UUID) or 32 (hash).
- Sequential: enables range queries on the backend ("markets 100–200").
- Deterministic: given the ID, any client can derive the Market PDA without a lookup.

### 4.3 Account Lifecycle

```
ProtocolConfig:  created once (initialize) → lives forever
UserRole:        created (assign_role) → closed (revoke_role)
Market:          created (create_market) → lives forever (even after settlement)
UserPosition:    created (first buy) → optionally closed after claim
LpPosition:      created (first add_liquidity) → closed on full withdrawal
VaultAuthority:  implicit PDA, no account data (just a signing authority)
Vault (ATA):     created alongside market → closed when market fully settled
```

---

## 5. AMM Mathematics & Engine

### 5.1 Complete-Set Model

All markets use a **complete-set minting/burning** model as the foundation:

- A "complete set" = 1 token of every outcome. Cost: **$1** of collateral (because exactly one outcome will occur, this set always pays $1).
- Minting: trader deposits $C → receives C tokens of each outcome. Reserves increase by C in every slot.
- Burning: trader returns C tokens of each outcome → receives $C collateral. Reserves decrease by C in every slot.
- This ensures: `∀ i: total_minted = reserves[i] + Σ_users(user.holdings[i])`
- Vault balance = `total_minted` (plus accumulated LP fees, minus claimed payouts).

### 5.2 L2-Norm Invariant

The AMM maintains:

```
||reserves||₂² = Σ reserves[i]² = k²
```

where `k²` is stored as `k_squared: u128` (we work with squared values to avoid square roots where possible).

**Initial state** (uniform distribution at market creation with liquidity `L`):
```
reserves[i] = L / sqrt(N)   for all i = 0..N-1
k² = Σ (L/sqrt(N))² = N * L²/N = L²
k = L
total_minted = L / sqrt(N)   (collateral deposited = total_minted = L/sqrt(N) ... )
```

Wait — let me be precise. At creation:
- Creator deposits `L` collateral.
- This mints `L` complete sets: `L` tokens of each outcome go into reserves.
- So `reserves[i] = L` for all i, and `total_minted = L`.
- `k² = N * L² `. `k = L * sqrt(N)`.

But this gives uniform pricing with `price[i] = reserves[i]² / k² = L² / (N * L²) = 1/N`. Each outcome has equal probability 1/N. Correct.

**Scaling convention**: all token amounts and collateral use the **collateral token's native precision** (e.g., USDC has 6 decimals → 1 USDC = 1,000,000). Reserves are stored as `u64` in this native unit. `k_squared` is `u128` to handle the sum of squares without overflow (max single reserve ~2^64, squared ~2^128; sum of N squares fits in u128 for N ≤ 2^128/2^128 = 1, so we actually need care — see §5.5).

### 5.3 Discrete Market Trades (Binary & Multi-Outcome)

#### Buy Outcome `i`

**Inputs:** outcome index `i`, collateral amount `C` (how much the trader wants to spend).

**Algorithm:**

```
1. Charge trade fee:
     fee = C * trade_fee_bps / 10_000
     lp_fee = fee * lp_fee_share_bps / 10_000
     protocol_fee = fee - lp_fee
     effective_C = C - fee

2. Mint effective_C complete sets:
     reserves[j] += effective_C   for all j = 0..N-1
     total_minted += effective_C

3. Compute tokens of outcome i to give the trader:
     // After minting, reserves have excess (norm > k).
     // Give trader tokens of i until norm returns to k.
     // New reserves[i] = sqrt(k² - Σ_{j≠i} reserves[j]²)
     sum_others_sq = Σ_{j≠i} reserves[j]²
     new_reserves_i = isqrt(k_squared - sum_others_sq)
     tokens_out = reserves[i] - new_reserves_i

4. Update state:
     reserves[i] = new_reserves_i
     user.holdings[i] += tokens_out
     user.total_deposited += C
     lp_fee_accumulated += lp_fee
     Transfer protocol_fee to treasury

5. Transfer C from trader's ATA to vault
```

**Why this works:** Minting complete sets adds uniformly to all reserves, increasing the norm. Then we "drain" outcome `i` back to the curve, giving the excess to the trader. The trader paid for complete sets but kept only the outcome they wanted — the other outcomes stay in the AMM, increasing its reserves of non-i outcomes.

#### Sell Outcome `i`

**Inputs:** outcome index `i`, number of tokens to sell `T`.

**Algorithm:**

```
1. Verify user.holdings[i] >= T

2. Return T tokens to AMM:
     reserves[i] += T
     // Now norm > k (excess on the i-th axis)

3. Burn complete sets to return to invariant:
     // Find C such that after removing C from each reserve:
     // Σ (reserves[j] - C)² = k²
     // This is a quadratic in C (see §5.6 for solver)
     C = solve_burn_amount(reserves, k_squared)

4. Charge trade fee on C:
     fee = C * trade_fee_bps / 10_000
     net_return = C - fee
     (split fee same as buy)

5. Update state:
     reserves[j] -= C   for all j
     total_minted -= C
     user.holdings[i] -= T
     user.total_withdrawn += net_return

6. Transfer net_return from vault to trader's ATA
```

#### Implied Probability

```
price[i] = reserves[i]² / k_squared
```

These sum to 1 by the invariant. Displayed as percentages in the UI.

### 5.4 Continuous Market Trades (Distribution Markets)

#### Buy Distribution

**Inputs:** `mu` (center, scaled i64), `sigma` (width, scaled u64), `collateral_amount` (u64).

**Algorithm:**

```
1. Compute bin weights from Normal(mu, sigma):
     bin_width = (range_max - range_min) / num_outcomes
     for b in 0..num_outcomes:
       center_b = range_min + bin_width/2 + b * bin_width
       z = (center_b - mu) / sigma
       if |z| > 5: weight[b] = 0  // Tail cutoff
       else: weight[b] = exp_approx(-z²/2)
     Normalize: weight[b] /= Σ weight[b]

2. Charge trade fee (same as discrete)
     effective_C = collateral_amount - fee

3. Mint effective_C complete sets:
     reserves[b] += effective_C   for all b

4. Compute multi-bin token distribution:
     // Trader receives tokens proportional to weight[b]
     // We need to find a scalar λ such that:
     //   new_reserves[b] = reserves[b] - λ * weight[b]
     //   Σ new_reserves[b]² = k²
     //
     // Expanding:
     //   Σ (reserves[b] - λ·w[b])² = k²
     //   Σ reserves[b]² - 2λ Σ reserves[b]·w[b] + λ² Σ w[b]² = k²
     //
     // Let R2 = Σ reserves[b]² (should be > k² after minting)
     // Let RW = Σ reserves[b]·w[b]
     // Let W2 = Σ w[b]²
     //
     //   W2·λ² - 2RW·λ + (R2 - k²) = 0
     //   λ = (2RW - sqrt(4RW² - 4W2(R2-k²))) / (2W2)
     //   λ = (RW - sqrt(RW² - W2(R2-k²))) / W2
     //
     // Take the smaller positive root (minimum movement to restore invariant)

     R2 = Σ reserves[b]²
     RW = Σ reserves[b] * weight[b]
     W2 = Σ weight[b]²
     discriminant = RW² - W2 * (R2 - k_squared)
     lambda = (RW - isqrt(discriminant)) / W2

5. Compute tokens per bin:
     for b in 0..num_outcomes:
       tokens_out[b] = lambda * weight[b]
       reserves[b] -= tokens_out[b]
       user.holdings[b] += tokens_out[b]

6. Verify invariant:
     assert Σ reserves[b]² ≈ k_squared (within rounding tolerance)

7. Update total_minted, fee accumulators, transfer collateral
```

**Why proportional allocation?**
The trader's position mirrors their stated belief distribution. If they think the outcome is N(180, 30), they hold more tokens in bins around 180 and fewer in the tails. If the actual outcome falls near 180, they profit.

#### Sell Distribution

Symmetric to buy: trader specifies (μ, σ, token_amount). The program computes how many tokens per bin to return (proportional to the trader's current holding ratios or to the specified distribution), adds them back to reserves, then burns complete sets and returns collateral.

### 5.5 Precision & Overflow Analysis

**Scale factor:** All token amounts are in native mint precision (USDC: 10^6). Reserves are `u64`.

**k_squared overflow risk:**
```
max reserves[i] ≈ 2^64 ≈ 1.8 × 10^19
reserves[i]² ≈ 2^128
N bins at max: N * 2^128

For N = 256: 256 * 2^128 ≈ 2^136
u128 max = 2^128 - 1
```

This overflows! We need to either:
1. **Cap reserves per bin** (practical: no single bin will hold 2^64 tokens ≈ 18 billion USDC)
2. **Use u128 reserves** (doubles account size but eliminates overflow)
3. **Scale down** reserves by a known factor before squaring

**Chosen approach:** Use `u64` reserves (practical cap at ~10^12, i.e., $1M USDC per bin), and compute `k_squared` in `u128`. Each `reserves[i]²` fits in `u128` (max `~10^24 < 2^80`), and `N * 10^24` for N=256 is `~2.56 * 10^26 < 2^88`. Safe.

If a market grows beyond $1M per bin, reserves can be migrated to a v2 account schema with `u128` reserves.

### 5.6 Quadratic Solver (Burn Amount)

When selling tokens or removing liquidity, we need to solve:

```
Σ (reserves[j] - C)² = k²
```

Expanding:

```
Σ reserves[j]² - 2C Σ reserves[j] + N·C² = k²
R2 - 2C·S + N·C² = k²
N·C² - 2S·C + (R2 - k²) = 0
```

where `R2 = Σ reserves[j]²`, `S = Σ reserves[j]`.

```
C = (S - sqrt(S² - N(R2 - k²))) / N
```

We take the smaller root (less collateral returned = conservative).

### 5.7 Liquidity Provision

#### Add Liquidity

LP deposits collateral `D`. The AMM scales proportionally:

```
scale_factor = D / total_minted    // fractional increase

for i in 0..N:
  reserves[i] += reserves[i] * scale_factor
  // Equivalently: reserves[i] = reserves[i] * (total_minted + D) / total_minted

k_squared = k_squared * ((total_minted + D) / total_minted)²
total_minted += D
lp_shares_new = lp_shares_total * D / total_minted_before_deposit
lp_shares_total += lp_shares_new
user_lp.shares += lp_shares_new
```

This preserves the invariant because scaling all reserves by a constant `α` scales the L2-norm by `α`.

#### Remove Liquidity

LP withdraws fraction `f = user_lp.shares / lp_shares_total`:

```
collateral_out = total_minted * f
fee_share = lp_fee_accumulated * f

for i in 0..N:
  reserves[i] -= reserves[i] * f

k_squared = k_squared * (1 - f)²
total_minted -= collateral_out
lp_fee_accumulated -= fee_share
lp_shares_total -= user_lp.shares
user_lp.shares = 0

Transfer (collateral_out + fee_share) to LP
```

### 5.8 Settlement & Payout

After oracle resolves with winning outcome `w`:

> **Note (2026-03-28):** The proportional payout formula below was the original design. The implementation was refactored to **1:1 fixed payout** (`gross_payout = winning_tokens`). See `RESOLUTION_REFACTOR_TASKS.md` and `MAJOR_BUGS.md` (BUG-003) for rationale.

```
// For binary/multi: w = outcome index
// For continuous: w = bin index containing resolved value

winning_tokens_total = total_minted - reserves[w]
  // = all tokens of outcome w held by traders + those "consumed" by AMM = total_minted - reserves[w]
  // Actually: total tokens of outcome w ever created = total_minted
  //           AMM still holds reserves[w] of them
  //           Traders collectively hold total_minted - reserves[w]

payout_pool = vault_balance - lp_fee_accumulated
  // Everything in the vault minus unclaimed LP fees

payout_per_token = payout_pool / winning_tokens_total
  // Normally ≈ 1.0 (in collateral units), can be slightly above due to rounding
```

For a specific trader claiming:

```
gross_payout = user.holdings[w] * payout_per_token
fee = gross_payout * redemption_fee_bps / 10_000
net_payout = gross_payout - fee

user.claimed = true
Transfer net_payout to trader
Transfer fee to treasury
```

**Edge case: no winning tokens outstanding** (`winning_tokens_total == 0`). This means no trader holds any tokens of the winning outcome — the AMM holds all of them. All collateral goes to LPs (residual claim). This is the AMM equivalent of "the house wins."

### 5.9 Normal PDF Approximation (On-Chain)

For continuous markets, we need `exp(-z²/2)` for each bin. On-chain options:

**Approach: Rational polynomial approximation (Abramowitz & Stegun)**

For `z ≥ 0`, approximate `exp(-z²/2)`:

```
// For |z| ≤ 5 (covers 99.99994% of the distribution):
// Use a degree-4 minimax polynomial on z²
// P(z²) ≈ exp(-z²/2)
//
// Coefficients (scaled to 10^9 fixed-point):
// exp(-t/2) ≈ 1 - t/2 + t²/8 - t³/48 + t⁴/384
// where t = z²
//
// Better: use Horner form for efficiency
// exp(-t/2) ≈ ((((t/384 - 1/48) * t + 1/8) * t - 1/2) * t + 1)
```

This requires ~5 multiplications and 4 additions per bin — roughly 20 CU per bin, 5,120 CU for 256 bins. Very feasible.

**Accuracy**: Taylor series of degree 4 is accurate to ~0.1% for |z| ≤ 3. Beyond that, the tail weights are negligible anyway (and clamped to 0 for |z| > 5).

---

## 6. State Transition Logic

### 6.1 Market State Machine

```
                     ┌──────────────────────────────────────────┐
                     │         Market State Machine              │
                     │                                          │
                     │  States:                                 │
                     │    0 = Active                            │
                     │    1 = Paused                            │
                     │    2 = PendingResolution                 │
                     │    3 = Resolved                          │
                     │                                          │
                     │  (no explicit "Created" state;           │
                     │   market is Active immediately           │
                     │   after create_market succeeds)          │
                     └──────────────────────────────────────────┘

    create_market
    (Creator+)
         │
         ▼
    ┌─────────┐  pause_market    ┌─────────┐
    │  Active  │────────────────▶│ Paused  │
    │  (0)     │◀────────────────│  (1)    │
    └────┬─────┘  unpause_market └────┬────┘
         │                            │
         │ [deadline passes]          │ [deadline passes while paused]
         │ (checked on next           │ (checked on next
         │  instruction)              │  instruction)
         ▼                            ▼
    ┌─────────────────┐          ┌─────────────────┐
    │ PendingResolution│◀────────│  (auto-          │
    │  (2)             │         │   transitions)   │
    └────────┬─────────┘         └──────────────────┘
             │
             │ resolve_market (Oracle)
             ▼
    ┌─────────────┐
    │  Resolved   │
    │   (3)       │
    └─────────────┘
         │
         │ [all positions claimed — optional cleanup]
         ▼
       (terminal)
```

### 6.2 Transition Guards

| Transition | Trigger | Guards |
|-----------|---------|--------|
| → Active | `create_market` | Creator/Admin/Superadmin role. Valid params. Initial liquidity > 0. Deadline in future. Oracle has Oracle role. |
| Active → Paused | `pause_market` | Admin/Superadmin. Market state == Active. |
| Paused → Active | `unpause_market` | Admin/Superadmin. Market state == Paused. Current time < deadline. |
| Active → PendingResolution | auto | `clock.unix_timestamp >= market.deadline`. Checked at the start of `buy`, `sell`, `add_liquidity`, `remove_liquidity`. If deadline passed, instruction transitions market state and returns error "MarketClosed". |
| Paused → PendingResolution | auto | Same clock check. Can happen when an admin calls `unpause_market` after deadline — the instruction transitions to PendingResolution instead. |
| PendingResolution → Resolved | `resolve_market` | Signer == market.oracle. Market state == PendingResolution. Outcome is valid (binary: 0 or 1; multi: < num_outcomes; continuous: value in [range_min, range_max]). |

### 6.3 Allowed Instructions Per State

| State | Allowed Instructions |
|-------|---------------------|
| Active | `buy`, `sell`, `buy_distribution`, `sell_distribution`, `add_liquidity`, `remove_liquidity`, `pause_market` |
| Paused | `unpause_market`, `pause_market` (idempotent) |
| PendingResolution | `resolve_market` |
| Resolved | `claim_payout`, `remove_liquidity` (LP exit) |

### 6.4 Deadline Enforcement

The deadline is **not** enforced by a crank or external trigger. Instead:

1. Every trading/LP instruction checks `clock.unix_timestamp < market.deadline` as its first guard.
2. If the deadline has passed and the market is Active or Paused, the instruction **transitions the state to PendingResolution** and returns `MarketClosed` error. The state transition is committed even though the trade is rejected.
3. This is gas-efficient (no crank needed) and correct (the first person to interact after deadline triggers the transition).

---

## 7. Oracle Integration Design

### 7.1 Architecture

```
                           ┌───────────────────┐
                           │  Oracle Operator   │
                           │  (human + wallet)  │
                           └────────┬──────────┘
                                    │
                          signs resolve_market tx
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────┐
│  Solana Program                                           │
│                                                           │
│  resolve_market instruction:                              │
│  1. Verify signer == market.oracle                        │
│  2. Verify market.state == PendingResolution              │
│  3. Validate outcome:                                     │
│     - Binary: outcome ∈ {0, 1}                           │
│     - Multi: outcome < num_outcomes                       │
│     - Continuous: range_min ≤ value ≤ range_max          │
│  4. Compute winning bin (continuous):                     │
│     bin = (value - range_min) * num_outcomes              │
│              / (range_max - range_min)                    │
│     bin = min(bin, num_outcomes - 1)  // clamp            │
│  5. Store resolved_outcome, resolved_value, resolved_at   │
│  6. Set state = Resolved                                  │
│  7. Emit ResolvedEvent                                    │
└───────────────────────────────────────────────────────────┘
```

### 7.2 Oracle Assignment

- At `create_market`, the creator passes the oracle's pubkey.
- The program verifies a `UserRole` PDA exists for `(oracle_pubkey, role=Oracle)`.
- The oracle pubkey is stored in `market.oracle` and cannot be changed after creation.
- One oracle can be assigned to many markets. Each market has exactly one oracle.

### 7.3 Resolution Data

| Market Type | Oracle Submits | Stored As |
|-------------|---------------|-----------|
| Binary | `outcome: u8` (0=No, 1=Yes) | `resolved_outcome = outcome` |
| Multi-outcome | `outcome: u16` (index) | `resolved_outcome = outcome` |
| Continuous | `value: i64` (scaled, e.g., $180.50 → 180_500_000_000) | `resolved_value = value`, `resolved_outcome = computed bin` |

### 7.4 No-Resolution Scenario

If an oracle never resolves a market, it stays in PendingResolution indefinitely. This is an acknowledged MVP limitation. Mitigations:
- Social pressure / off-chain reputation of oracles.
- Admin can reassign oracle in a future version.
- For MVP: choose trusted oracles. The admin panel shows "stale" markets (pending resolution for > X days) for monitoring.

---

## 8. Off-Chain Services

### 8.1 Backend Architecture (NestJS)

```
backend/
├── src/
│   ├── app.module.ts
│   │
│   ├── modules/
│   │   ├── market/
│   │   │   ├── market.module.ts
│   │   │   ├── market.service.ts       # CRUD, search, filter
│   │   │   ├── market.controller.ts    # REST endpoints
│   │   │   └── market.entity.ts        # TypeORM entity
│   │   │
│   │   ├── indexer/
│   │   │   ├── indexer.module.ts
│   │   │   ├── indexer.service.ts      # Solana event listener
│   │   │   └── parser.ts              # Anchor event deserialization
│   │   │
│   │   ├── amm/
│   │   │   ├── amm.module.ts
│   │   │   ├── amm.service.ts         # Off-chain AMM simulation
│   │   │   └── normal.ts              # Normal PDF computation
│   │   │
│   │   ├── auth/
│   │   │   ├── auth.module.ts
│   │   │   ├── auth.service.ts        # Wallet signature verification
│   │   │   └── auth.guard.ts          # NestJS guard
│   │   │
│   │   └── user/
│   │       ├── user.module.ts
│   │       ├── user.service.ts        # User profile, positions
│   │       └── user.entity.ts
│   │
│   ├── common/
│   │   ├── solana.provider.ts         # Connection, commitment config
│   │   └── idl.ts                     # Imported Anchor IDL types
│   │
│   └── main.ts
│
├── .env
├── package.json
└── tsconfig.json
```

### 8.2 Backend Responsibilities

| Responsibility | Why Backend (not Frontend-only) |
|---------------|-------------------------------|
| **Market metadata storage** | Descriptions, categories, tags, images — too large/expensive for on-chain storage. |
| **Search & discovery** | Full-text search, category filtering, sorting by volume/deadline — requires a database, not feasible via RPC. |
| **Event indexing** | Transforms raw Solana events into structured, queryable database records. |
| **AMM cost estimation** | Simulates trades off-chain for instant cost previews without hitting RPC. Backend mirrors on-chain AMM logic in TypeScript. |
| **Cached state** | Caches current reserves, prices, positions — reduces RPC load, enables fast page loads. |

| **Not** responsible for | Why |
|------------------------|-----|
| Signing transactions | No private keys on backend. |
| Holding funds | All collateral is on-chain in program-controlled vaults. |
| Authorization for trading | Anyone can trade. Wallet signs directly. |
| Being the single source of truth | On-chain state is authoritative. Backend is a cache. |

### 8.3 API Endpoints (Key Routes)

```
GET    /markets                  # List/search markets (paginated, filterable)
GET    /markets/:id              # Market detail (metadata + cached on-chain state)
GET    /markets/:id/prices       # Current implied probabilities
GET    /markets/:id/history      # Trade history for this market
POST   /markets                  # Create market metadata (authenticated, Creator+)

GET    /users/:address/positions # User's positions across all markets
GET    /users/:address/history   # User's trade history

POST   /amm/estimate-buy        # Off-chain cost estimation for a buy
POST   /amm/estimate-sell       # Off-chain return estimation for a sell

POST   /auth/challenge           # Request a sign-in challenge nonce
POST   /auth/verify              # Submit signed challenge → receive JWT

GET    /admin/roles              # List all role assignments
GET    /admin/markets/stale      # Markets pending resolution past threshold
```

---

## 9. Backend Indexing Architecture

### 9.1 Indexing Strategy

The indexer runs as a persistent NestJS service (not a separate process). It uses **Solana WebSocket subscription** to the program's event logs in real-time, with a **polling fallback** for missed events.

```
┌────────────────────────────────────────────────────────┐
│  Indexer Service                                        │
│                                                        │
│  1. On startup:                                        │
│     - Read last_processed_slot from DB                 │
│     - Backfill: fetch all program txs from             │
│       last_processed_slot to current slot              │
│     - Parse Anchor events from each tx                 │
│     - Write to DB                                      │
│                                                        │
│  2. Real-time:                                         │
│     - Subscribe to program logs via                    │
│       connection.onLogs(programId)                     │
│     - Parse Anchor events from log lines               │
│     - Write to DB                                      │
│     - Update last_processed_slot                       │
│                                                        │
│  3. Periodic health check (every 60s):                 │
│     - Compare DB state vs RPC account state            │
│     - If diverged, trigger backfill for gap            │
│                                                        │
│  4. On-chain state cache:                              │
│     - After processing events, fetch full              │
│       Market account data via RPC getAccountInfo       │
│     - Cache reserves[], k_squared, state, etc.         │
│     - Serves as the source for API responses           │
└────────────────────────────────────────────────────────┘
```

### 9.2 Anchor Events Emitted by Program

```rust
// Defined in the program, emitted via emit!()

#[event]
pub struct MarketCreated {
    pub market_id: u64,
    pub market_type: u8,
    pub creator: Pubkey,
    pub oracle: Pubkey,
    pub collateral_mint: Pubkey,
    pub deadline: i64,
    pub num_outcomes: u16,
    pub initial_liquidity: u64,
}

#[event]
pub struct TradePlaced {
    pub market_id: u64,
    pub trader: Pubkey,
    pub is_buy: bool,
    pub collateral_amount: u64,
    pub outcome_index: u16,        // For discrete
    pub mu: i64,                    // For continuous (0 if discrete)
    pub sigma: u64,                 // For continuous (0 if discrete)
    pub tokens_transacted: u64,     // Total tokens moved
    pub fee_paid: u64,
    pub timestamp: i64,
}

#[event]
pub struct MarketResolved {
    pub market_id: u64,
    pub oracle: Pubkey,
    pub resolved_outcome: u16,
    pub resolved_value: i64,
    pub timestamp: i64,
}

#[event]
pub struct PayoutClaimed {
    pub market_id: u64,
    pub trader: Pubkey,
    pub amount: u64,
    pub fee_paid: u64,
}

#[event]
pub struct LiquidityChanged {
    pub market_id: u64,
    pub provider: Pubkey,
    pub is_add: bool,
    pub collateral_amount: u64,
    pub shares_changed: u128,
    pub timestamp: i64,
}

#[event]
pub struct MarketPaused {
    pub market_id: u64,
    pub admin: Pubkey,
}

#[event]
pub struct MarketUnpaused {
    pub market_id: u64,
    pub admin: Pubkey,
}
```

### 9.3 Database Schema

```sql
-- Markets (on-chain state cache + off-chain metadata)
CREATE TABLE markets (
    id                  BIGINT PRIMARY KEY,        -- market_id from chain
    pubkey              VARCHAR(44) NOT NULL UNIQUE,-- Market PDA address
    market_type         SMALLINT NOT NULL,          -- 0=binary, 1=multi, 2=cont
    state               SMALLINT NOT NULL,          -- 0=active, 1=paused, etc.
    creator             VARCHAR(44) NOT NULL,
    oracle              VARCHAR(44) NOT NULL,
    collateral_mint     VARCHAR(44) NOT NULL,
    deadline            TIMESTAMP NOT NULL,
    created_at          TIMESTAMP NOT NULL,
    resolved_at         TIMESTAMP,
    num_outcomes        SMALLINT NOT NULL,

    -- Off-chain metadata (not on-chain)
    title               TEXT NOT NULL,
    description         TEXT,
    category            VARCHAR(64),
    tags                TEXT[],                     -- PostgreSQL array
    image_url           TEXT,
    outcome_labels      TEXT[],                     -- For discrete markets

    -- Cached on-chain state
    reserves            BIGINT[] NOT NULL,          -- Current AMM reserves
    k_squared           NUMERIC NOT NULL,           -- u128 stored as NUMERIC
    total_minted        NUMERIC NOT NULL,
    resolved_outcome    SMALLINT,
    resolved_value      BIGINT,

    -- Derived / aggregated
    total_volume        NUMERIC DEFAULT 0,          -- Sum of all trade collateral
    total_traders       INTEGER DEFAULT 0,
    last_trade_at       TIMESTAMP,

    updated_at          TIMESTAMP DEFAULT NOW()
);

-- Trades (historical log)
CREATE TABLE trades (
    id                  BIGSERIAL PRIMARY KEY,
    market_id           BIGINT NOT NULL REFERENCES markets(id),
    trader              VARCHAR(44) NOT NULL,
    is_buy              BOOLEAN NOT NULL,
    collateral_amount   BIGINT NOT NULL,
    outcome_index       SMALLINT,                   -- Discrete
    mu                  BIGINT,                      -- Continuous
    sigma               BIGINT,                      -- Continuous
    tokens_transacted   BIGINT NOT NULL,
    fee_paid            BIGINT NOT NULL,
    tx_signature        VARCHAR(88) NOT NULL UNIQUE,
    slot                BIGINT NOT NULL,
    timestamp           TIMESTAMP NOT NULL
);
CREATE INDEX idx_trades_market ON trades(market_id);
CREATE INDEX idx_trades_trader ON trades(trader);

-- User positions (cached)
CREATE TABLE user_positions (
    id                  BIGSERIAL PRIMARY KEY,
    market_id           BIGINT NOT NULL REFERENCES markets(id),
    user_address        VARCHAR(44) NOT NULL,
    holdings            BIGINT[] NOT NULL,
    total_deposited     BIGINT NOT NULL DEFAULT 0,
    total_withdrawn     BIGINT NOT NULL DEFAULT 0,
    claimed             BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at          TIMESTAMP DEFAULT NOW(),
    UNIQUE(market_id, user_address)
);

-- LP positions (cached)
CREATE TABLE lp_positions (
    id                  BIGSERIAL PRIMARY KEY,
    market_id           BIGINT NOT NULL REFERENCES markets(id),
    user_address        VARCHAR(44) NOT NULL,
    shares              NUMERIC NOT NULL,
    deposited_collateral BIGINT NOT NULL DEFAULT 0,
    updated_at          TIMESTAMP DEFAULT NOW(),
    UNIQUE(market_id, user_address)
);

-- Indexer bookkeeping
CREATE TABLE indexer_state (
    id                  INTEGER PRIMARY KEY DEFAULT 1,
    last_processed_slot BIGINT NOT NULL DEFAULT 0,
    last_processed_at   TIMESTAMP DEFAULT NOW()
);

-- Role assignments (cached)
CREATE TABLE user_roles (
    id                  BIGSERIAL PRIMARY KEY,
    user_address        VARCHAR(44) NOT NULL,
    role                SMALLINT NOT NULL,          -- 1=Admin, 2=Oracle, 3=Creator
    assigned_by         VARCHAR(44) NOT NULL,
    assigned_at         TIMESTAMP NOT NULL,
    UNIQUE(user_address, role)
);
```

---

## 10. Frontend Architecture

### 10.1 Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Framework | **Next.js 14+** (App Router) | SSR for SEO on market pages, API routes for BFF pattern, React ecosystem. |
| Styling | **Tailwind CSS** | Rapid iteration, consistent design, dark mode built-in. |
| Component library | **shadcn/ui** | Headless components on top of Radix. Customizable. Tailwind-native. |
| Charts | **Recharts** or **Visx** | Distribution curves, price history. Visx for custom SVG (bell curves). |
| State management | **TanStack Query** (React Query) | Server-state caching for backend API + RPC data. Automatic revalidation. |
| Wallet | **@solana/wallet-adapter-react** | Standard Solana wallet integration (Phantom, Solflare, Backpack). |
| Solana SDK | **@coral-xyz/anchor** | Anchor client for building/sending transactions. IDL-typed. |
| Forms | **React Hook Form + Zod** | Validated inputs for trade params, market creation. |

### 10.2 Page Architecture

```
app/
├── layout.tsx                  # Root layout: providers, wallet, nav, dark mode
├── page.tsx                    # Home: featured markets, trending, categories
│
├── markets/
│   ├── page.tsx                # Market discovery: search, filter, sort
│   └── [id]/
│       └── page.tsx            # Market detail: chart, trading panel, history
│
├── portfolio/
│   └── page.tsx                # User's positions, PnL, claimable payouts
│
├── admin/
│   ├── page.tsx                # Admin dashboard: roles, fees, paused markets
│   └── create-market/
│       └── page.tsx            # Market creation form
│
├── oracle/
│   └── page.tsx                # Oracle dashboard: pending markets, resolve form
│
└── api/                        # BFF routes (optional, for SSR data fetching)
```

### 10.3 Component Architecture

```
components/
├── layout/
│   ├── Navbar.tsx              # Logo, wallet button, nav links
│   ├── Footer.tsx
│   └── Sidebar.tsx             # Category navigation
│
├── market/
│   ├── MarketCard.tsx          # Compact card for discovery grid
│   ├── MarketDetail.tsx        # Full market view container
│   ├── MarketStatus.tsx        # State badge (Active, Paused, Resolved)
│   ├── PriceBar.tsx            # Horizontal probability bar (binary/multi)
│   └── DistributionChart.tsx   # SVG bell curve (continuous markets)
│
├── trading/
│   ├── TradingPanel.tsx        # Container: input + preview + confirm
│   ├── BinaryInput.tsx         # Slider: 0%–100% for Yes probability
│   ├── MultiOutcomeInput.tsx   # Per-outcome probability sliders
│   ├── DistributionInput.tsx   # Center + Confidence inputs with live curve
│   ├── CostPreview.tsx         # Shows estimated cost before tx
│   ├── PositionSummary.tsx     # Current holdings in this market
│   └── TradeHistory.tsx        # Past trades for this market
│
├── portfolio/
│   ├── PositionCard.tsx        # One market's position
│   ├── ClaimButton.tsx         # Claim payout (resolved markets)
│   └── PnLSummary.tsx          # Aggregate PnL
│
├── admin/
│   ├── RoleManager.tsx         # Assign/revoke roles
│   ├── FeeConfig.tsx           # Update fee sliders
│   ├── MarketCreationForm.tsx  # Multi-step market creation
│   └── PauseControls.tsx       # Pause/unpause market
│
├── oracle/
│   ├── PendingMarkets.tsx      # Markets awaiting resolution
│   └── ResolveForm.tsx         # Submit outcome
│
└── common/
    ├── WalletButton.tsx        # Connect/disconnect wallet
    ├── TransactionToast.tsx    # Tx success/error notifications
    ├── LoadingSpinner.tsx
    └── ErrorBoundary.tsx
```

### 10.4 Distribution Input UX Design

The core UX innovation. Must be simpler than Metaculus while preserving expressiveness.

```
┌───────────────────────────────────────────────────────┐
│  What do you think SOL price will be on July 1?       │
│                                                       │
│  ┌─ Your Prediction ──────────────────────────────┐   │
│  │                                                 │   │
│  │  Center: [ $180.00        ] ← numeric input     │   │
│  │  ──────────────●──────────── ← slider ($50-500) │   │
│  │                                                 │   │
│  │  Confidence: ████████░░░░░░ ← "Pretty sure"    │   │
│  │  (Very sure ◄──────────────► Very uncertain)    │   │
│  │                                                 │   │
│  │  Maps to: σ = $30  (±$30 covers 68% chance)    │   │
│  │                                                 │   │
│  └─────────────────────────────────────────────────┘   │
│                                                       │
│  ┌─ Preview ──────────────────────────────────────┐   │
│  │                                                 │   │
│  │    ╱╲  ← Your belief (blue)                     │   │
│  │   ╱  ╲                                          │   │
│  │  ╱    ╲  ╱─╲ ← Current market (gray dashed)    │   │
│  │ ╱      ╲╱   ╲                                   │   │
│  │╱              ╲                                  │   │
│  │────────────────────────────────────────────     │   │
│  │$50    $150   $250   $350   $450   $500         │   │
│  └─────────────────────────────────────────────────┘   │
│                                                       │
│  ┌─ Cost ─────────────────────────────────────────┐   │
│  │  Amount to stake: [ 100 USDC    ]               │   │
│  │  Trade fee:         0.30 USDC                   │   │
│  │  Total cost:       100.30 USDC                  │   │
│  │  Max payout:       ~$340 (if SOL = $180)        │   │
│  │  Min payout:       $0 (if SOL < $80 or > $280)  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                       │
│  [ Place Trade ]                                      │
└───────────────────────────────────────────────────────┘
```

**Confidence ↔ σ mapping:**
The "Confidence" slider maps to σ on a logarithmic scale:
- Far left ("Very sure"): σ = range_width / 100 (very narrow)
- Middle: σ = range_width / 10
- Far right ("Very uncertain"): σ = range_width / 2 (nearly uniform)

This avoids requiring users to understand standard deviation.

### 10.5 Data Flow

```
┌────────────────────────────────────────────────────────────────┐
│  Frontend Data Flow                                            │
│                                                                │
│  1. DISCOVERY (market list):                                   │
│     Frontend → GET /markets (backend API)                      │
│     Backend returns cached list from PostgreSQL                │
│                                                                │
│  2. MARKET DETAIL (prices, reserves):                          │
│     Frontend → GET /markets/:id (backend API) for metadata     │
│     Frontend → RPC getAccountInfo(marketPDA) for live reserves │
│     TanStack Query merges both into a single cache entry       │
│                                                                │
│  3. COST ESTIMATION:                                           │
│     Frontend → POST /amm/estimate-buy (backend)                │
│     Backend runs off-chain AMM simulation                      │
│     Returns: { tokens_out, cost, fee, implied_probabilities }  │
│     (No RPC call; backend uses cached reserves)                │
│     Updates on every slider/input change (debounced 200ms)     │
│                                                                │
│  4. TRADE EXECUTION:                                           │
│     Frontend builds Anchor instruction (buy/sell/buy_dist)     │
│     Wallet signs transaction                                   │
│     Frontend submits to Solana RPC (sendTransaction)           │
│     On confirmation: invalidate TanStack Query cache           │
│     Backend indexer picks up event, updates DB                 │
│                                                                │
│  5. POSITIONS:                                                 │
│     Frontend → RPC getAccountInfo(userPositionPDA)             │
│     Or: Frontend → GET /users/:addr/positions (backend cache)  │
│     For claim: frontend reads on-chain position directly       │
└────────────────────────────────────────────────────────────────┘
```

### 10.6 Wallet Integration

```
Providers (in root layout):
  ConnectionProvider (RPC endpoint)
    └── WalletProvider (adapters: Phantom, Solflare, Backpack)
        └── WalletModalProvider
            └── App

Transaction building:
  1. Import program IDL (auto-generated by Anchor)
  2. Create Program instance: new Program(IDL, programId, provider)
  3. Build instruction: program.methods.buy(args).accounts({...}).instruction()
  4. Create VersionedTransaction (v0) with ComputeBudget if needed
  5. wallet.signTransaction(tx)
  6. connection.sendRawTransaction(tx.serialize())
  7. connection.confirmTransaction(sig, "confirmed")
```

---

## 11. Failure Modes & Attack Surfaces

### 11.1 Program-Level Threats

| # | Threat | Severity | Likelihood | Mitigation |
|---|--------|----------|------------|------------|
| P1 | **Arithmetic overflow in AMM math** | Critical | Medium | All operations use checked_mul, checked_add, checked_sub. u128 intermediates for squared values. Explicit overflow checks before casting. Fuzzing with edge-case inputs (max reserves, tiny trades, zero values). |
| P2 | **L2-norm invariant violation** | Critical | Low | Post-trade assertion: `verify_invariant(reserves, k_squared)` with tolerance band (±1 due to rounding). If violated, revert the entire instruction. |
| P3 | **Vault insolvency (more claimed than deposited)** | Critical | Low | Payout calculation: `payout_per_token = vault_balance / winning_tokens`. Even with rounding, the vault can never pay more than it holds because claims are sequential and checked. Last claimant may receive 1–2 lamports less due to rounding — acceptable. |
| P4 | **Wrong PDA derivation (seed confusion)** | High | Low | All seeds use distinct prefixes ("market", "user_position", etc.). Anchor's `#[account]` constraints verify PDA derivation at runtime. Seeds are const strings, never user-supplied. |
| P5 | **Unauthorized role escalation** | High | Low | Role checks: derive expected UserRole PDA and verify it exists + matches. Admin cannot self-escalate to Superadmin (Superadmin is stored in ProtocolConfig, not a role PDA). |
| P6 | **Double-claim payout** | High | Low | `user_position.claimed` boolean checked before any payout. Set to `true` atomically in the same instruction. |
| P7 | **Trade on expired market** | Medium | High | First guard in every trading instruction: check `clock.unix_timestamp < market.deadline`. Transition state if expired. |
| P8 | **Rounding exploits (repeated small trades to extract value)** | Medium | Medium | Round in the protocol's favor: `tokens_out = floor(computed)`, `cost = ceil(computed)`. Minimum trade amount enforced (e.g., 1000 lamports = $0.001 USDC). |
| P9 | **Account reallocation attack** | Low | Low | All accounts have fixed sizes determined at init. No realloc used. Variable-length arrays (reserves, holdings) are sized at creation and never change. |

### 11.2 Oracle Threats

| # | Threat | Severity | Likelihood | Mitigation |
|---|--------|----------|------------|------------|
| O1 | **Oracle submits wrong outcome (malicious or error)** | Critical | Low (trusted) | MVP accepts this risk. Oracle is a trusted human. Mitigation: only assign oracle role to known, reputable parties. Future: dispute mechanism, decentralized oracle. |
| O2 | **Oracle never resolves** | High | Low | Market stays in PendingResolution forever. Funds are locked. Mitigation: admin monitoring dashboard shows stale markets. Future: fallback resolution mechanism or admin override. |
| O3 | **Oracle front-runs resolution** | High | Medium | Oracle knows the outcome before submitting → can trade beforehand. Mitigation: MVP deadline enforcement means no trades after deadline, so oracle can't trade after learning the answer AND after the market closes. Pre-deadline front-running is an accepted risk (oracle shouldn't trade on own markets — social norm). |

### 11.3 Economic / MEV Attacks

| # | Threat | Severity | Likelihood | Mitigation |
|---|--------|----------|------------|------------|
| E1 | **Sandwich attack on trades** | Medium | High (on mainnet) | Attacker front-runs a large trade, moves price, then back-runs to profit. MVP does not mitigate. Future: slippage tolerance parameter, commit-reveal, Jito bundles. |
| E2 | **Price manipulation via large trades** | Medium | Medium | L2-norm AMM has natural resistance: cost increases quadratically as reserves deplete. A large trade to one outcome is expensive. Not a complete mitigation but provides some protection. |
| E3 | **LP griefing (add/remove liquidity to manipulate)** | Low | Low | LP add/remove is proportional — it doesn't change prices, only depth. No meaningful attack vector. |
| E4 | **Dust positions to bloat account space** | Low | Medium | UserPosition is created on first trade, costs rent (~0.002 SOL). This is self-limiting. No additional mitigation needed. |

### 11.4 Infrastructure Threats

| # | Threat | Severity | Likelihood | Mitigation |
|---|--------|----------|------------|------------|
| I1 | **Backend compromise (DB tampering)** | Medium | Low | Backend serves metadata and cached state. Tampering with cached reserves shows wrong prices but cannot affect on-chain state. Frontend should validate critical data (reserves, position) against RPC for trading. |
| I2 | **Backend downtime** | Medium | Medium | Frontend can fall back to direct RPC reads. Market discovery degrades (no search/filter) but trading still works via direct program interaction. |
| I3 | **RPC node failure** | Medium | Medium | Use multiple RPC providers with fallback. TanStack Query retries automatically. |
| I4 | **Upgrade authority compromise** | Critical | Low | Attacker with upgrade key can replace the program and drain all vaults. MVP accepts this risk (single key). Future: multisig, timelock, DAO governance. |
| I5 | **Indexer falls behind / misses events** | Low | Medium | Health check (§9.1) detects drift. Backfill catches up. Cached state may be temporarily stale — frontend falls back to RPC. |

### 11.5 Invariants to Monitor (Operational)

These should be checked periodically by the backend health service:

1. **For each market:** `Σ reserves[i]²` ≈ `k_squared` (on-chain invariant holds).
2. **For each market:** vault SPL balance ≥ `total_minted` (solvency).
3. **For each market:** `Σ_users(user.holdings[i]) + reserves[i]` ≈ `total_minted` for all `i` (conservation).
4. **Global:** no UserRole PDA exists for a wallet that shouldn't have that role (admin review).
5. **Markets pending resolution > 7 days:** alert admin.

---

## Appendix A: Fixed-Point Arithmetic Spec

### Scale Factor

All internal math uses a **scale factor of 10^9** (SCALE = 1_000_000_000).

- Token amounts remain in native mint precision (USDC: 10^6 = 1 USDC).
- Probability weights, ratios, and intermediate values are scaled to 10^9 for precision.
- When multiplying two scaled values: result is scaled to 10^18 → divide by SCALE to get 10^9.

### Core Operations

```
fn scaled_mul(a: u128, b: u128) -> u128 {
    // a and b are scaled by 10^9
    // result = a * b / 10^9
    a.checked_mul(b).unwrap() / SCALE
}

fn scaled_div(a: u128, b: u128) -> u128 {
    // result = a * 10^9 / b
    a.checked_mul(SCALE).unwrap() / b
}

fn isqrt(n: u128) -> u128 {
    // Integer square root via Newton's method
    // Converges in ~64 iterations for u128
    if n == 0 { return 0; }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}
```

### Overflow Boundaries

| Operation | Max Input | Result | Fits in |
|-----------|-----------|--------|---------|
| `reserve²` | 10^12 (= $1M USDC) | 10^24 | u128 (max 3.4×10^38) |
| `Σ reserve²` (N=256) | 256 × 10^24 | 2.56×10^26 | u128 |
| `scaled_mul(10^12, 10^12)` | — | 10^24 / 10^9 = 10^15 | u128 |
| `reserve² × SCALE` (for division) | 10^24 × 10^9 | 10^33 | u128 |

All operations fit comfortably in u128 for the expected value range ($1M max per bin). If markets grow larger, a scaling reduction or u256 library would be needed.

---

## Appendix B: CU Budget Analysis

Estimated compute unit costs per instruction:

| Instruction | Key Operations | Estimated CU | Within Default? |
|-------------|---------------|-------------|-----------------|
| `initialize` | Init 1 PDA | ~5,000 | Yes (200K) |
| `assign_role` | Init 1 PDA, verify signer role | ~8,000 | Yes |
| `create_market` (binary, N=2) | Init Market PDA, init vault, CPI transfer, set reserves | ~25,000 | Yes |
| `create_market` (continuous, N=256) | Same + write 256 reserves | ~40,000 | Yes |
| `buy` (discrete, N=2) | Read reserves, compute sqrt, update 2 reserves, CPI transfer | ~15,000 | Yes |
| `buy` (discrete, N=32) | Same but sum 32 squares | ~25,000 | Yes |
| `buy_distribution` (N=64) | 64× PDF approx + quadratic solve + 64× reserve update | ~60,000 | Yes |
| `buy_distribution` (N=128) | 128× PDF + solve + 128× update | ~110,000 | Yes |
| `buy_distribution` (N=256) | 256× PDF + solve + 256× update | ~200,000 | Borderline |
| `sell` / `sell_distribution` | Similar to buy | Same | Same |
| `add_liquidity` (N=256) | 256× scale reserves + LP math | ~80,000 | Yes |
| `remove_liquidity` (N=256) | Same | ~80,000 | Yes |
| `claim_payout` | Read position, compute payout, CPI transfer | ~15,000 | Yes |
| `resolve_market` | Compute winning bin, update state | ~10,000 | Yes |

**For N=256 continuous markets:** `buy_distribution` may need `ComputeBudgetProgram.setComputeUnitLimit(400_000)` prepended to the transaction. This is standard practice.

**Optimization path if CU is tight:**
1. Only iterate over non-zero bins (skip tails where weight = 0).
2. Precompute `Σ reserves[i]²` incrementally (store as `k_squared` — already done).
3. Use bitwise operations for the sqrt approximation.

---

## Appendix C: Account Sizing Tables

### Rent Costs (at 0.00000348 SOL per byte per epoch, exempt = 2 years)

| Account | Size (bytes) | Rent-exempt (SOL) | Per Market |
|---------|-------------|-------------------|------------|
| ProtocolConfig | 154 | ~0.002 | 1 total |
| UserRole | 83 | ~0.001 | Per role assignment |
| Market (binary) | 304 | ~0.003 | 1 per market |
| Market (multi-32) | 544 | ~0.005 | 1 per market |
| Market (cont-64) | 800 | ~0.007 | 1 per market |
| Market (cont-128) | 1,312 | ~0.011 | 1 per market |
| Market (cont-256) | 2,336 | ~0.019 | 1 per market |
| UserPosition (binary) | 123 | ~0.002 | Per user×market |
| UserPosition (cont-256) | 2,155 | ~0.017 | Per user×market |
| LpPosition | 114 | ~0.001 | Per LP×market |
| Vault (SPL Token Account) | 165 | ~0.002 | 1 per market |

**Worst case per continuous-256 market with 100 traders and 10 LPs:**
```
Market:        0.019 SOL
Vault:         0.002 SOL
100 Positions: 1.700 SOL
10 LP:         0.010 SOL
Total:         ~1.73 SOL  (~$300 at $170/SOL)
```

This is the rent cost borne collectively by users (each user pays rent for their own Position PDA). Acceptable for MVP.

---

*End of TDD v1.0*
