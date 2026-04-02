"""Base types for agent actions."""
from dataclasses import dataclass, field
from enum import Enum, auto
from typing import FrozenSet
import numpy as np


class ActionType(Enum):
    SINGLE_BIN_BUY = auto()
    SINGLE_BIN_SELL = auto()
    BUNDLE_BUY = auto()
    BUNDLE_SELL = auto()
    LP_DEPOSIT = auto()
    LP_WITHDRAW = auto()
    LP_REBALANCE = auto()
    ORDER_PLACE = auto()
    ORDER_CANCEL = auto()


@dataclass
class TradeAction:
    agent_id: int
    bin_idx: int
    side: str  # "buy" or "sell"
    amount: int  # collateral-native units


@dataclass
class DistributionTradeAction(TradeAction):
    mu: int = 0
    sigma: int = 0
    weights: np.ndarray | None = None


@dataclass
class AgentState:
    agent_id: int
    capital: int
    holdings: dict  # bin_idx → tokens held
    cumulative_volume: int = 0
    deposited_lp: int = 0
    fees_earned: int = 0
    realized_pnl: float = 0.0


@dataclass
class DecisionContext:
    implied_probs: np.ndarray
    total_minted: int
    reserves: np.ndarray
    current_round: int
    total_rounds: int
    design: int
    fee_model: int
    agent_state: AgentState
    allowed_actions: FrozenSet[ActionType]
    scenario_family: str
    belief_family: str
    settlement_rule: str


# Settlement rule lookup by design index
SETTLEMENT_RULES = {
    0: "wta",
    1: "wta",
    2: "piecewise",
    3: "kernel",
    4: "scalar",
    5: "crps",
    6: "piecewise",
}

# Allowed action sets per market type
AMM_ACTIONS: FrozenSet[ActionType] = frozenset({
    ActionType.SINGLE_BIN_BUY,
    ActionType.SINGLE_BIN_SELL,
    ActionType.BUNDLE_BUY,
    ActionType.BUNDLE_SELL,
    ActionType.LP_DEPOSIT,
    ActionType.LP_WITHDRAW,
    ActionType.LP_REBALANCE,
})

CLOB_ACTIONS: FrozenSet[ActionType] = frozenset({
    ActionType.SINGLE_BIN_BUY,
    ActionType.SINGLE_BIN_SELL,
    ActionType.ORDER_PLACE,
    ActionType.ORDER_CANCEL,
})
