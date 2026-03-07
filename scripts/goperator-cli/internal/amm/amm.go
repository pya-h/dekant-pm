// Package amm provides client-side L2-norm AMM simulation for inverse trade computation.
//
// Used to find the collateral needed to buy a target number of shares,
// or the shares needed to sell for a target collateral amount.
package amm

import (
	"fmt"
	"math/big"
)

var (
	zero = big.NewInt(0)
	one  = big.NewInt(1)
	two  = big.NewInt(2)
	bps  = big.NewInt(10000)
)

// isqrt returns the integer square root of n (floor(sqrt(n))).
func isqrt(n *big.Int) *big.Int {
	if n.Sign() < 0 {
		panic("isqrt of negative")
	}
	if n.Cmp(two) < 0 {
		return new(big.Int).Set(n)
	}
	x := new(big.Int).Set(n)
	y := new(big.Int)
	y.Add(x, one)
	y.Rsh(y, 1) // y = (x+1)/2

	for y.Cmp(x) < 0 {
		x.Set(y)
		// y = (x + n/x) / 2
		y.Div(n, x)
		y.Add(y, x)
		y.Rsh(y, 1)
	}
	return x
}

// SimulateBuy simulates a discrete buy and returns tokens_out.
// All values are *big.Int. reserves is not mutated.
func SimulateBuy(reserves []*big.Int, totalMinted *big.Int, outcome int, effectiveCollateral *big.Int) *big.Int {
	if effectiveCollateral.Sign() <= 0 {
		return big.NewInt(0)
	}

	xi := new(big.Int).Sub(totalMinted, reserves[outcome])
	sumOthersXSq := new(big.Int)
	for j := range reserves {
		if j != outcome {
			x := new(big.Int).Sub(totalMinted, reserves[j])
			sumOthersXSq.Add(sumOthersXSq, new(big.Int).Mul(x, x))
		}
	}

	kNew := new(big.Int).Add(totalMinted, effectiveCollateral)
	kNewSq := new(big.Int).Mul(kNew, kNew)
	if kNewSq.Cmp(sumOthersXSq) < 0 {
		return big.NewInt(0)
	}
	diff := new(big.Int).Sub(kNewSq, sumOthersXSq)
	xNewI := isqrt(diff)
	if xNewI.Cmp(xi) <= 0 {
		return big.NewInt(0)
	}
	return new(big.Int).Sub(xNewI, xi)
}

// SimulateSell simulates a discrete sell and returns gross collateral_out (before fees).
// reserves is not mutated.
func SimulateSell(reserves []*big.Int, totalMinted *big.Int, outcome int, tokensIn *big.Int) *big.Int {
	if tokensIn.Sign() <= 0 {
		return big.NewInt(0)
	}

	newReserve := new(big.Int).Add(reserves[outcome], tokensIn)
	kNewSq := new(big.Int)
	for j := range reserves {
		var r *big.Int
		if j == outcome {
			r = newReserve
		} else {
			r = reserves[j]
		}
		x := new(big.Int).Sub(totalMinted, r)
		kNewSq.Add(kNewSq, new(big.Int).Mul(x, x))
	}

	kNew := isqrt(kNewSq)
	if totalMinted.Cmp(kNew) <= 0 {
		return big.NewInt(0)
	}
	return new(big.Int).Sub(totalMinted, kNew)
}

func computeFee(grossAmount *big.Int, tradeFeeBps uint16) *big.Int {
	fee := new(big.Int).Mul(grossAmount, big.NewInt(int64(tradeFeeBps)))
	fee.Div(fee, bps)
	return fee
}

func netAfterFee(grossAmount *big.Int, tradeFeeBps uint16) *big.Int {
	return new(big.Int).Sub(grossAmount, computeFee(grossAmount, tradeFeeBps))
}

// FindCollateralForShares finds the gross collateral amount needed to buy at least targetShares.
func FindCollateralForShares(reserves []*big.Int, totalMinted *big.Int, outcome int, targetShares *big.Int, tradeFeeBps uint16) *big.Int {
	lo := new(big.Int).Set(one)
	hi := new(big.Int).Set(targetShares)
	minHi := big.NewInt(1_000_000)
	if hi.Cmp(minHi) < 0 {
		hi.Set(minHi)
	}

	// Expand hi until enough tokens come out
	for i := 0; i < 80; i++ {
		net := netAfterFee(hi, tradeFeeBps)
		if net.Sign() > 0 && SimulateBuy(reserves, totalMinted, outcome, net).Cmp(targetShares) >= 0 {
			break
		}
		hi.Mul(hi, two)
	}

	// Binary search
	for lo.Cmp(hi) < 0 {
		mid := new(big.Int).Add(lo, hi)
		mid.Rsh(mid, 1)
		net := netAfterFee(mid, tradeFeeBps)
		tokensOut := big.NewInt(0)
		if net.Sign() > 0 {
			tokensOut = SimulateBuy(reserves, totalMinted, outcome, net)
		}
		if tokensOut.Cmp(targetShares) >= 0 {
			hi.Set(mid)
		} else {
			lo.Add(mid, one)
		}
	}
	return new(big.Int).Set(lo)
}

// FindTokensForCollateral finds the token amount to sell to receive at least targetCollateral (after fees).
func FindTokensForCollateral(reserves []*big.Int, totalMinted *big.Int, outcome int, targetCollateral *big.Int, tradeFeeBps uint16) (*big.Int, error) {
	maxTokens := new(big.Int).Sub(totalMinted, reserves[outcome])
	if maxTokens.Sign() <= 0 {
		return nil, fmt.Errorf("no position to sell")
	}

	// Feasibility check
	maxGross := SimulateSell(reserves, totalMinted, outcome, maxTokens)
	maxNet := netAfterFee(maxGross, tradeFeeBps)
	if maxNet.Cmp(targetCollateral) < 0 {
		return nil, fmt.Errorf("cannot receive that much; max receivable: %s", maxNet.String())
	}

	lo := new(big.Int).Set(one)
	hi := new(big.Int).Set(maxTokens)

	for lo.Cmp(hi) < 0 {
		mid := new(big.Int).Add(lo, hi)
		mid.Rsh(mid, 1)
		grossOut := SimulateSell(reserves, totalMinted, outcome, mid)
		netOut := netAfterFee(grossOut, tradeFeeBps)
		if netOut.Cmp(targetCollateral) >= 0 {
			hi.Set(mid)
		} else {
			lo.Add(mid, one)
		}
	}
	return new(big.Int).Set(lo), nil
}
