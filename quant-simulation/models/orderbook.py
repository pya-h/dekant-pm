"""Price-time priority limit orderbook for CLOB hybrid simulation."""
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class Side(Enum):
    BUY = "buy"
    SELL = "sell"


@dataclass
class Order:
    agent_id: int
    bin_idx: int
    price: int   # SCALE-denominated probability
    size: int    # collateral-native units
    side: Side
    timestamp: int = 0  # set by orderbook on placement


@dataclass
class Fill:
    maker_id: int
    taker_id: int
    bin_idx: int
    price: int
    size: int


class Orderbook:
    """Per-bin price-time priority limit orderbook.

    Tick size = 1 bin width (each bin has its own book).
    Matching: incoming orders walk the book at price-time priority.

    bids[bin_idx] sorted by price DESC, timestamp ASC (highest price first,
    then earliest timestamp for ties).
    asks[bin_idx] sorted by price ASC, timestamp ASC (lowest price first,
    then earliest timestamp for ties).

    BUY orders match against asks (lowest ask first); crossing = buy price >= ask price.
    SELL orders match against bids (highest bid first); crossing = sell price <= bid price.
    """

    def __init__(self, num_bins: int) -> None:
        self.num_bins = num_bins
        # Each bin holds a list of resting orders, kept sorted.
        # bids: price DESC, timestamp ASC
        # asks: price ASC,  timestamp ASC
        self.bids: list[list[Order]] = [[] for _ in range(num_bins)]
        self.asks: list[list[Order]] = [[] for _ in range(num_bins)]
        self._clock: int = 0

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def place_order(self, order: Order) -> list[Fill]:
        """Place an order; return list of fills generated (may be empty).

        The order's timestamp is set by the book's internal clock before
        any matching or resting occurs.
        """
        self._clock += 1
        order.timestamp = self._clock

        fills: list[Fill] = []

        if order.side == Side.BUY:
            fills = self._match_buy(order)
        else:
            fills = self._match_sell(order)

        # If size remains, rest the order.
        if order.size > 0:
            if order.side == Side.BUY:
                self._insert_bid(order.bin_idx, order)
            else:
                self._insert_ask(order.bin_idx, order)

        return fills

    def best_bid(self, b: int) -> Optional[int]:
        """Return price of the best (highest) resting bid for bin b, or None."""
        if not self.bids[b]:
            return None
        return self.bids[b][0].price

    def best_ask(self, b: int) -> Optional[int]:
        """Return price of the best (lowest) resting ask for bin b, or None."""
        if not self.asks[b]:
            return None
        return self.asks[b][0].price

    def mid_price(self, b: int) -> Optional[int]:
        """Return integer midpoint of best bid and best ask for bin b, or None."""
        bid = self.best_bid(b)
        ask = self.best_ask(b)
        if bid is None or ask is None:
            return None
        return (bid + ask) // 2

    def total_depth(self, b: int, side: Side) -> int:
        """Return total resting size on the given side for bin b."""
        book = self.bids[b] if side == Side.BUY else self.asks[b]
        return sum(o.size for o in book)

    # ------------------------------------------------------------------
    # Internal matching helpers
    # ------------------------------------------------------------------

    def _match_buy(self, order: Order) -> list[Fill]:
        """Match a buy order against resting asks (price-time priority)."""
        fills: list[Fill] = []
        asks = self.asks[order.bin_idx]

        while order.size > 0 and asks and order.price >= asks[0].price:
            resting = asks[0]
            traded = min(order.size, resting.size)

            fills.append(Fill(
                maker_id=resting.agent_id,
                taker_id=order.agent_id,
                bin_idx=order.bin_idx,
                price=resting.price,
                size=traded,
            ))

            resting.size -= traded
            order.size -= traded

            if resting.size == 0:
                asks.pop(0)

        return fills

    def _match_sell(self, order: Order) -> list[Fill]:
        """Match a sell order against resting bids (price-time priority)."""
        fills: list[Fill] = []
        bids = self.bids[order.bin_idx]

        while order.size > 0 and bids and order.price <= bids[0].price:
            resting = bids[0]
            traded = min(order.size, resting.size)

            fills.append(Fill(
                maker_id=resting.agent_id,
                taker_id=order.agent_id,
                bin_idx=order.bin_idx,
                price=resting.price,
                size=traded,
            ))

            resting.size -= traded
            order.size -= traded

            if resting.size == 0:
                bids.pop(0)

        return fills

    # ------------------------------------------------------------------
    # Sorted insertion helpers
    # ------------------------------------------------------------------

    def _insert_bid(self, bin_idx: int, order: Order) -> None:
        """Insert a resting bid maintaining price DESC, timestamp ASC order."""
        bids = self.bids[bin_idx]
        # Find the insertion index.
        # We want the first position where:
        #   existing.price < order.price  (new order has higher price → goes before)
        #   or (existing.price == order.price and existing.timestamp > order.timestamp)
        #      (same price: earlier timestamp → higher priority → already in list before us)
        idx = len(bids)
        for i, existing in enumerate(bids):
            if existing.price < order.price:
                idx = i
                break
            if existing.price == order.price and existing.timestamp > order.timestamp:
                idx = i
                break
        bids.insert(idx, order)

    def _insert_ask(self, bin_idx: int, order: Order) -> None:
        """Insert a resting ask maintaining price ASC, timestamp ASC order."""
        asks = self.asks[bin_idx]
        idx = len(asks)
        for i, existing in enumerate(asks):
            if existing.price > order.price:
                idx = i
                break
            if existing.price == order.price and existing.timestamp > order.timestamp:
                idx = i
                break
        asks.insert(idx, order)
