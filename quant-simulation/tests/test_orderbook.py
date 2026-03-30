"""Tests for price-time priority limit orderbook."""
import pytest
from models.orderbook import Orderbook, Order, Side


class TestOrderbook:
    def test_place_resting_order(self):
        ob = Orderbook(num_bins=10)
        ob.place_order(Order(agent_id=0, bin_idx=5, price=500_000_000, size=100, side=Side.BUY))
        assert len(ob.bids[5]) == 1

    def test_match_crossing_orders(self):
        ob = Orderbook(num_bins=10)
        ob.place_order(Order(agent_id=0, bin_idx=5, price=500_000_000, size=100, side=Side.BUY))
        fills = ob.place_order(Order(agent_id=1, bin_idx=5, price=400_000_000, size=80, side=Side.SELL))
        assert len(fills) == 1
        assert fills[0].size == 80
        assert ob.bids[5][0].size == 20

    def test_price_time_priority(self):
        ob = Orderbook(num_bins=10)
        ob.place_order(Order(agent_id=0, bin_idx=5, price=500_000_000, size=100, side=Side.BUY))
        ob.place_order(Order(agent_id=1, bin_idx=5, price=600_000_000, size=100, side=Side.BUY))
        fills = ob.place_order(Order(agent_id=2, bin_idx=5, price=400_000_000, size=50, side=Side.SELL))
        assert fills[0].maker_id == 1

    def test_no_match_if_price_doesnt_cross(self):
        ob = Orderbook(num_bins=10)
        ob.place_order(Order(agent_id=0, bin_idx=5, price=400_000_000, size=100, side=Side.BUY))
        fills = ob.place_order(Order(agent_id=1, bin_idx=5, price=500_000_000, size=100, side=Side.SELL))
        assert len(fills) == 0
        assert len(ob.asks[5]) == 1

    def test_full_fill_removes_resting_order(self):
        ob = Orderbook(num_bins=10)
        ob.place_order(Order(agent_id=0, bin_idx=5, price=500_000_000, size=100, side=Side.BUY))
        fills = ob.place_order(Order(agent_id=1, bin_idx=5, price=500_000_000, size=100, side=Side.SELL))
        assert len(fills) == 1
        assert fills[0].size == 100
        assert len(ob.bids[5]) == 0

    def test_multi_level_fill(self):
        ob = Orderbook(num_bins=10)
        ob.place_order(Order(agent_id=0, bin_idx=5, price=600_000_000, size=50, side=Side.BUY))
        ob.place_order(Order(agent_id=1, bin_idx=5, price=500_000_000, size=50, side=Side.BUY))
        fills = ob.place_order(Order(agent_id=2, bin_idx=5, price=400_000_000, size=80, side=Side.SELL))
        assert len(fills) == 2
        assert fills[0].maker_id == 0
        assert fills[1].maker_id == 1
        assert fills[0].size == 50
        assert fills[1].size == 30
        assert ob.bids[5][0].size == 20

    def test_best_bid_ask(self):
        ob = Orderbook(num_bins=10)
        assert ob.best_bid(5) is None
        assert ob.best_ask(5) is None
        ob.place_order(Order(agent_id=0, bin_idx=5, price=400_000_000, size=100, side=Side.BUY))
        ob.place_order(Order(agent_id=1, bin_idx=5, price=600_000_000, size=100, side=Side.SELL))
        assert ob.best_bid(5) == 400_000_000
        assert ob.best_ask(5) == 600_000_000

    def test_mid_price(self):
        ob = Orderbook(num_bins=10)
        assert ob.mid_price(5) is None
        ob.place_order(Order(agent_id=0, bin_idx=5, price=400_000_000, size=100, side=Side.BUY))
        ob.place_order(Order(agent_id=1, bin_idx=5, price=600_000_000, size=100, side=Side.SELL))
        assert ob.mid_price(5) == 500_000_000

    def test_total_depth(self):
        ob = Orderbook(num_bins=10)
        ob.place_order(Order(agent_id=0, bin_idx=5, price=400_000_000, size=60, side=Side.BUY))
        ob.place_order(Order(agent_id=1, bin_idx=5, price=450_000_000, size=40, side=Side.BUY))
        assert ob.total_depth(5, Side.BUY) == 100
        assert ob.total_depth(5, Side.SELL) == 0

    def test_time_priority_same_price(self):
        ob = Orderbook(num_bins=10)
        ob.place_order(Order(agent_id=0, bin_idx=5, price=500_000_000, size=100, side=Side.BUY))
        ob.place_order(Order(agent_id=1, bin_idx=5, price=500_000_000, size=100, side=Side.BUY))
        fills = ob.place_order(Order(agent_id=2, bin_idx=5, price=400_000_000, size=50, side=Side.SELL))
        # agent_id=0 placed first so should be matched first
        assert fills[0].maker_id == 0

    def test_sell_matches_against_bids(self):
        ob = Orderbook(num_bins=10)
        ob.place_order(Order(agent_id=0, bin_idx=3, price=700_000_000, size=200, side=Side.SELL))
        fills = ob.place_order(Order(agent_id=1, bin_idx=3, price=700_000_000, size=150, side=Side.BUY))
        assert len(fills) == 1
        assert fills[0].maker_id == 0
        assert fills[0].taker_id == 1
        assert fills[0].size == 150

    def test_buy_matches_against_asks(self):
        ob = Orderbook(num_bins=10)
        ob.place_order(Order(agent_id=0, bin_idx=3, price=300_000_000, size=200, side=Side.BUY))
        fills = ob.place_order(Order(agent_id=1, bin_idx=3, price=300_000_000, size=150, side=Side.SELL))
        assert len(fills) == 1
        assert fills[0].maker_id == 0
        assert fills[0].taker_id == 1
        assert fills[0].size == 150

    def test_clock_increments(self):
        ob = Orderbook(num_bins=10)
        o1 = Order(agent_id=0, bin_idx=5, price=500_000_000, size=100, side=Side.BUY)
        o2 = Order(agent_id=1, bin_idx=5, price=500_000_000, size=100, side=Side.BUY)
        ob.place_order(o1)
        ob.place_order(o2)
        assert ob.bids[5][0].timestamp < ob.bids[5][1].timestamp

    def test_remainder_rests_after_partial_fill(self):
        ob = Orderbook(num_bins=10)
        ob.place_order(Order(agent_id=0, bin_idx=5, price=400_000_000, size=50, side=Side.BUY))
        fills = ob.place_order(Order(agent_id=1, bin_idx=5, price=300_000_000, size=100, side=Side.SELL))
        assert len(fills) == 1
        assert fills[0].size == 50
        assert len(ob.asks[5]) == 1
        assert ob.asks[5][0].size == 50
