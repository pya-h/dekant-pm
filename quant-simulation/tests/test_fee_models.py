"""Tests for all 5 fee mechanisms."""
import numpy as np
import pytest
from models.fee_models import flat_fee, dynamic_fee, tiered_fee, spread_fee, time_weighted_fee
from config.params import SCALE


class TestFlatFee:
    def test_basic(self):
        result = flat_fee(gross=1_000_000, trade_fee_bps=30, lp_share_bps=5000)
        assert result["total_fee"] == 3000
        assert result["lp_fee"] == 1500
        assert result["protocol_fee"] == 1500
        assert result["net_amount"] == 997_000


class TestDynamicFee:
    def test_higher_fee_when_imbalanced(self):
        probs = np.array([800_000_000, 100_000_000, 100_000_000], dtype=np.int64)
        fee_balanced = dynamic_fee(1_000_000, probs, base_bps=30, max_bps=100, lp_share_bps=5000)
        probs_even = np.array([333_333_334, 333_333_333, 333_333_333], dtype=np.int64)
        fee_even = dynamic_fee(1_000_000, probs_even, base_bps=30, max_bps=100, lp_share_bps=5000)
        assert fee_balanced["total_fee"] > fee_even["total_fee"]


class TestTieredFee:
    def test_larger_trade_lower_rate(self):
        small = tiered_fee(100_000, cumulative_volume=0, base_bps=30, discount_per_tier=5, tier_size=1_000_000, lp_share_bps=5000)
        large = tiered_fee(100_000, cumulative_volume=5_000_000, base_bps=30, discount_per_tier=5, tier_size=1_000_000, lp_share_bps=5000)
        assert large["total_fee"] <= small["total_fee"]


class TestSpreadFee:
    def test_against_consensus_costs_more(self):
        probs = np.array([600_000_000, 200_000_000, 200_000_000], dtype=np.int64)
        fee_with = spread_fee(1_000_000, outcome=0, probs=probs, base_bps=30, max_bps=100, lp_share_bps=5000)
        fee_against = spread_fee(1_000_000, outcome=2, probs=probs, base_bps=30, max_bps=100, lp_share_bps=5000)
        assert fee_against["total_fee"] >= fee_with["total_fee"]


class TestTimeWeightedFee:
    def test_fee_increases_near_deadline(self):
        early = time_weighted_fee(1_000_000, current_round=10, total_rounds=200, base_bps=10, max_bps=100, lp_share_bps=5000)
        late = time_weighted_fee(1_000_000, current_round=190, total_rounds=200, base_bps=10, max_bps=100, lp_share_bps=5000)
        assert late["total_fee"] > early["total_fee"]

    def test_round_zero_uses_base(self):
        result = time_weighted_fee(1_000_000, current_round=0, total_rounds=200, base_bps=10, max_bps=100, lp_share_bps=5000)
        assert result["total_fee"] == 1000
