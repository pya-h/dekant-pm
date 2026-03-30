"""Tests for the L2-norm CFAMM math engine — faithful port of on-chain Rust code."""

import numpy as np
import pytest
from models.math_engine import (
    isqrt,
    init_reserves,
    compute_probabilities,
    compute_buy,
    compute_sell,
    compute_distribution_buy,
    compute_distribution_sell,
    verify_invariant,
)
from config.params import SCALE


class TestIsqrt:
    def test_zero(self):
        assert isqrt(0) == 0

    def test_one(self):
        assert isqrt(1) == 1

    def test_perfect_square(self):
        assert isqrt(144) == 12

    def test_non_perfect_square(self):
        assert isqrt(150) == 12

    def test_large_value(self):
        val = 10**36
        assert isqrt(val) == 10**18


class TestInitReserves:
    def test_uniform_distribution(self):
        n_bins = 4
        liquidity = 1_000_000_000
        reserves, total_minted = init_reserves(n_bins, liquidity)
        assert len(reserves) == n_bins
        assert total_minted == liquidity
        assert np.all(reserves == reserves[0])

    def test_invariant_holds_after_init(self):
        reserves, total_minted = init_reserves(256, 10_000_000_000)
        assert verify_invariant(reserves, total_minted, tolerance=SCALE)


class TestComputeProbabilities:
    def test_uniform_sums_to_scale(self):
        reserves, total_minted = init_reserves(4, 1_000_000_000)
        probs = compute_probabilities(reserves, total_minted)
        assert len(probs) == 4
        assert abs(int(np.sum(probs)) - SCALE) < 100

    def test_uniform_equal_probs(self):
        reserves, total_minted = init_reserves(4, 1_000_000_000)
        probs = compute_probabilities(reserves, total_minted)
        expected = SCALE // 4
        for p in probs:
            assert abs(int(p) - expected) < 100


class TestComputeBuy:
    def test_buy_increases_position(self):
        reserves, total_minted = init_reserves(4, 1_000_000_000)
        reserves_before = reserves.copy()
        tokens_out, new_total = compute_buy(reserves, total_minted, outcome=0, collateral=10_000_000)
        assert tokens_out > 0
        assert new_total == total_minted + 10_000_000
        assert reserves[0] < reserves_before[0] + 10_000_000

    def test_buy_raises_probability(self):
        reserves, total_minted = init_reserves(4, 1_000_000_000)
        probs_before = compute_probabilities(reserves, total_minted)
        _, new_total = compute_buy(reserves, total_minted, outcome=0, collateral=10_000_000)
        probs_after = compute_probabilities(reserves, new_total)
        assert probs_after[0] > probs_before[0]


class TestComputeSell:
    def test_sell_returns_collateral(self):
        reserves, total_minted = init_reserves(4, 1_000_000_000)
        tokens_out, total_minted = compute_buy(reserves, total_minted, outcome=0, collateral=10_000_000)
        collateral_out, new_total = compute_sell(reserves, total_minted, outcome=0, tokens_in=tokens_out // 2)
        assert collateral_out > 0
        assert new_total < total_minted


class TestDistributionBuy:
    def test_distribution_buy_returns_tokens_per_bin(self):
        reserves, total_minted = init_reserves(8, 1_000_000_000)
        weights = np.full(8, SCALE // 8, dtype=np.int64)
        weights[0] += SCALE - np.sum(weights)
        tokens_out, new_total = compute_distribution_buy(reserves, total_minted, weights, collateral=10_000_000)
        assert len(tokens_out) == 8
        assert new_total == total_minted + 10_000_000
        assert np.all(tokens_out >= 0)


class TestDistributionSell:
    def test_distribution_sell_returns_collateral(self):
        reserves, total_minted = init_reserves(8, 1_000_000_000)
        weights = np.full(8, SCALE // 8, dtype=np.int64)
        weights[0] += SCALE - np.sum(weights)
        tokens_out, total_minted = compute_distribution_buy(reserves, total_minted, weights, collateral=10_000_000)
        collateral_out, new_total = compute_distribution_sell(reserves, total_minted, weights, total_tokens=np.sum(tokens_out) // 2)
        assert collateral_out > 0
        assert new_total < total_minted
