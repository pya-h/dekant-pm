"""All tunable simulation parameters in one place."""

from dataclasses import dataclass, field

# ── On-chain constants (faithful port) ──────────────────────────────
SCALE: int = 1_000_000_000  # 10^9 fixed-point denominator
INVARIANT_TOLERANCE: int = 256
Z_CUTOFF: int = 5

# ── Market defaults ─────────────────────────────────────────────────
DEFAULT_NUM_BINS: int = 256
DEFAULT_RANGE_MIN: int = 0
DEFAULT_RANGE_MAX: int = 100 * SCALE  # e.g. 0–100 scaled
DEFAULT_INITIAL_LIQUIDITY: int = 10_000 * 1_000_000  # 10k USDC in native units

# ── Fee defaults (basis points) ─────────────────────────────────────
DEFAULT_TRADE_FEE_BPS: int = 30
DEFAULT_LP_FEE_SHARE_BPS: int = 5000  # 50% of trade fee to LPs

# ── Simulation ──────────────────────────────────────────────────────
DEFAULT_NUM_ROUNDS: int = 200
DEFAULT_MC_RUNS: int = 1000

# ── Dynamic bandwidth ──────────────────────────────────────────────
# target_payout_width chosen so W=5 at 256 bins with range_span=100*SCALE
DEFAULT_TARGET_PAYOUT_WIDTH: int = 5 * (100 * SCALE) // 256

# ── Agent mix (fractions summing to 1.0) ────────────────────────────
@dataclass
class AgentMix:
    noise: float = 0.45
    informed: float = 0.25
    arbitrageur: float = 0.13
    manipulator: float = 0.05
    late_round_whale: float = 0.02
    lp_passive: float = 0.05
    lp_rebalancing: float = 0.05

# ── Agent parameters ───────────────────────────────────────────────
@dataclass
class InformedParams:
    conviction: float = 0.5
    capital_limit: int = 1_000 * 1_000_000  # 1k USDC

@dataclass
class NoiseParams:
    trade_min: int = 1_000  # 0.001 USDC
    trade_max: int = 100 * 1_000_000  # 100 USDC
    frequency: float = 0.8  # probability of acting each round

@dataclass
class ArbitrageurParams:
    min_edge: float = 0.005  # 0.5% minimum profit threshold

@dataclass
class ManipulatorParams:
    target_bin: int = 128  # middle bin by default
    budget: int = 5_000 * 1_000_000  # 5k USDC

@dataclass
class WhaleParams:
    target_bin: int = 128
    budget: int = 50_000 * 1_000_000  # 50k USDC
    activation_round_pct: float = 0.9  # activates in last 10%

@dataclass
class LpPassiveParams:
    yield_threshold: float = 0.001  # 0.1% per round
    loss_tolerance: float = 0.05  # 5% max drawdown

@dataclass
class LpRebalancingParams:
    yield_threshold: float = 0.001
    loss_tolerance: float = 0.05
    rebalance_interval: int = 10  # every 10 rounds
    concentration_factor: float = 2.0  # 2x weight toward active bins

# ── Metric weights for composite score ─────────────────────────────
@dataclass
class MetricWeights:
    resolution_fairness: float = 0.20
    price_accuracy: float = 0.15
    convergence_speed: float = 0.15
    capital_efficiency: float = 0.10
    lp_profitability: float = 0.10
    manipulation_resistance: float = 0.10
    boundary_sensitivity: float = 0.10
    exitability: float = 0.10

# ── Design and fee enums ───────────────────────────────────────────
DESIGN_BASELINE_A = 0
DESIGN_BASELINE_B = 1
DESIGN_PIECEWISE = 2
DESIGN_KERNEL = 3
DESIGN_SCALAR = 4
DESIGN_CRPS = 5
DESIGN_CLOB = 6

FEE_FLAT = 0
FEE_DYNAMIC = 1
FEE_TIERED = 2
FEE_SPREAD = 3
FEE_TIME_WEIGHTED = 4

DESIGN_NAMES = [
    "Baseline A (Taylor-4 + WTA)",
    "Baseline B (Exact + WTA)",
    "Piecewise-Linear",
    "Kernel-Smoothed",
    "Scalar",
    "CRPS Scoring Rule",
    "CLOB Hybrid",
]

FEE_NAMES = [
    "Flat (30 bps)",
    "Dynamic",
    "Tiered",
    "Spread-based",
    "Time-weighted",
]
