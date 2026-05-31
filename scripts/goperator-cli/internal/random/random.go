package random

import (
	"fmt"
	"math/rand"
	"time"

	"goperator-cli/internal/constants"
)

// Generator generates random values for protocol testing.
type Generator struct {
	rng *rand.Rand
}

// NewGenerator creates a new random generator.
func NewGenerator() *Generator {
	return &Generator{
		rng: rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

// NewGeneratorWithSeed creates a seeded random generator.
func NewGeneratorWithSeed(seed int64) *Generator {
	return &Generator{
		rng: rand.New(rand.NewSource(seed)),
	}
}

// UserLabel generates a random user label.
func (g *Generator) UserLabel(index int) string {
	adjectives := []string{"Swift", "Bold", "Lucky", "Sharp", "Clever", "Quick", "Wild", "Calm"}
	nouns := []string{"Trader", "Whale", "Bull", "Bear", "Fox", "Hawk", "Wolf", "Lion"}
	adj := adjectives[g.rng.Intn(len(adjectives))]
	noun := nouns[g.rng.Intn(len(nouns))]
	return fmt.Sprintf("%s%s%d", adj, noun, index)
}

// Liquidity generates a random liquidity amount (50-500 USDC).
func (g *Generator) Liquidity() string {
	amount := 50 + g.rng.Intn(451) // 50-500
	return fmt.Sprintf("%d", amount)
}

// Deadline generates a random deadline (+30m to +24h).
func (g *Generator) Deadline() string {
	minutes := 30 + g.rng.Intn(24*60-30) // 30min to 24h
	if minutes >= 60 {
		return fmt.Sprintf("+%dh", minutes/60)
	}
	return fmt.Sprintf("+%dm", minutes)
}

// MarketType generates a random market type.
func (g *Generator) MarketType() string {
	types := []string{"binary", "multi", "continuous"}
	return types[g.rng.Intn(len(types))]
}

// NumOutcomes generates random num outcomes for the given type.
func (g *Generator) NumOutcomes(marketType string) string {
	switch marketType {
	case "binary":
		return "2"
	case "multi":
		return fmt.Sprintf("%d", 3+g.rng.Intn(6)) // 3-8
	case "continuous":
		bins := []int{16, 32, 64}
		return fmt.Sprintf("%d", bins[g.rng.Intn(len(bins))])
	}
	return "2"
}

// RangeValues generates random range min/max for continuous markets.
func (g *Generator) RangeValues() (string, string) {
	min := 10 + g.rng.Intn(91)          // 10-100
	spread := 100 + g.rng.Intn(901)     // 100-1000
	return fmt.Sprintf("%d", min), fmt.Sprintf("%d", min+spread)
}

// KernelWidth generates a kernel width in {0..min(maxWidth, 9)} for
// continuous markets. Returns "0" (WTA) ~25% of the time so the WTA path
// stays in the rotation; otherwise returns a value in {1..cap}.
// Caller is responsible for clamping to numBins-1.
func (g *Generator) KernelWidth(maxWidth int) string {
	cap := maxWidth
	if cap > 9 {
		cap = 9
	}
	if cap <= 0 {
		return "0"
	}
	if g.rng.Float64() < 0.25 {
		return "0"
	}
	return fmt.Sprintf("%d", 1+g.rng.Intn(cap))
}

// TradeAmount generates a random trade amount (5-30 USDC).
func (g *Generator) TradeAmount() string {
	amount := 5 + g.rng.Intn(26) // 5-30
	return fmt.Sprintf("%d", amount)
}

// BuyAmountForBalance generates a buy amount as 1-20% of balance.
func (g *Generator) BuyAmountForBalance(balanceRaw uint64) string {
	if balanceRaw == 0 {
		return "5"
	}
	pct := 1 + g.rng.Intn(20) // 1-20%
	amount := balanceRaw * uint64(pct) / 100
	// Convert to USDC (6 decimals)
	amountUSDC := amount / 1_000_000
	if amountUSDC < 1 {
		amountUSDC = 1
	}
	return fmt.Sprintf("%d", amountUSDC)
}

// SellAmount generates a sell amount as 1-50% of holdings.
func (g *Generator) SellAmount(holdingsRaw uint64) string {
	if holdingsRaw == 0 {
		return "1"
	}
	pct := 1 + g.rng.Intn(50) // 1-50%
	amount := holdingsRaw * uint64(pct) / 100
	amountUSDC := amount / 1_000_000
	if amountUSDC < 1 {
		amountUSDC = 1
	}
	return fmt.Sprintf("%d", amountUSDC)
}

// Outcome generates a random outcome index.
func (g *Generator) Outcome(numOutcomes int) string {
	return fmt.Sprintf("%d", g.rng.Intn(numOutcomes))
}

// TargetProbability generates a random target probability (current + 5-30%).
func (g *Generator) TargetProbability(currentProb float64) string {
	delta := 5.0 + float64(g.rng.Intn(26)) // 5-30%
	target := currentProb*100 + delta
	if target > 95 {
		target = 95
	}
	return fmt.Sprintf("%.1f", target)
}

// Mu generates a random mu within a range.
func (g *Generator) Mu(rangeMin, rangeMax float64) string {
	spread := rangeMax - rangeMin
	mu := rangeMin + spread*0.2 + float64(g.rng.Intn(int(spread*0.6+1)))
	return fmt.Sprintf("%.1f", mu)
}

// Sigma generates a random sigma (5-30% of range width).
func (g *Generator) Sigma(rangeMin, rangeMax float64) string {
	spread := rangeMax - rangeMin
	pct := 5 + g.rng.Intn(26) // 5-30%
	sigma := spread * float64(pct) / 100
	return fmt.Sprintf("%.1f", sigma)
}

// ResolveOutcome generates a random outcome for resolution.
func (g *Generator) ResolveOutcome(numOutcomes int) string {
	return fmt.Sprintf("%d", g.rng.Intn(numOutcomes))
}

// ResolveValue generates a random value within range for continuous resolution.
func (g *Generator) ResolveValue(rangeMin, rangeMax float64) string {
	spread := rangeMax - rangeMin
	value := rangeMin + spread*0.1 + float64(g.rng.Intn(int(spread*0.8+1)))
	return fmt.Sprintf("%.1f", value)
}

// FundAmount generates a random funding amount (50-500 USDC).
func (g *Generator) FundAmount() string {
	amount := 50 + g.rng.Intn(451) // 50-500
	return fmt.Sprintf("%d", amount)
}

// Role generates a random role.
func (g *Generator) Role() string {
	roles := []string{"Oracle", "Creator"}
	return roles[g.rng.Intn(len(roles))]
}

// RoleName maps a role name to its constant.
func RoleName(role uint8) string {
	return constants.RoleNames[role]
}
