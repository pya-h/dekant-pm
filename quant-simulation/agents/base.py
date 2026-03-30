"""Base types for agent actions."""
from dataclasses import dataclass


@dataclass
class TradeAction:
    agent_id: int
    bin_idx: int
    side: str  # "buy" or "sell"
    amount: int  # collateral-native units


@dataclass
class AgentState:
    agent_id: int
    capital: int
    holdings: dict  # bin_idx → tokens held
    cumulative_volume: int = 0
    deposited_lp: int = 0
    fees_earned: int = 0
