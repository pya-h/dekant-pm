package util

import (
	"fmt"
	"math"
	"math/big"
	"strings"
	"time"

	"goperator-cli/internal/constants"

	"github.com/gagliardetto/solana-go"
)

// FormatTokenAmount formats a raw token amount (u64) as a human-readable decimal string.
func FormatTokenAmount(amount uint64) string {
	divisor := uint64(math.Pow10(constants.USDC_DECIMALS))
	whole := amount / divisor
	frac := amount % divisor
	fracStr := fmt.Sprintf("%0*d", constants.USDC_DECIMALS, frac)
	fracStr = strings.TrimRight(fracStr, "0")
	if fracStr == "" {
		return fmt.Sprintf("%d", whole)
	}
	return fmt.Sprintf("%d.%s", whole, fracStr)
}

// ParseTokenAmount parses a human-readable token string ("100.5") to raw amount (u64).
func ParseTokenAmount(s string) uint64 {
	parts := strings.SplitN(s, ".", 2)
	whole := parts[0]
	frac := ""
	if len(parts) > 1 {
		frac = parts[1]
	}
	// Pad or truncate frac to USDC_DECIMALS
	if len(frac) < constants.USDC_DECIMALS {
		frac += strings.Repeat("0", constants.USDC_DECIMALS-len(frac))
	} else {
		frac = frac[:constants.USDC_DECIMALS]
	}

	combined := whole + frac
	val := new(big.Int)
	val.SetString(combined, 10)
	return val.Uint64()
}

// FormatProbability formats a float probability as a percentage string.
func FormatProbability(prob float64) string {
	return fmt.Sprintf("%.2f%%", prob*100)
}

// ComputeProbabilities computes outcome probabilities from reserves and totalMinted.
// Formula: p_i = (totalMinted - reserves_i)^2 / totalMinted^2
func ComputeProbabilities(reserves []uint64, totalMinted *big.Int) []float64 {
	tm := new(big.Float).SetInt(totalMinted)
	tmF, _ := tm.Float64()
	if tmF == 0 {
		probs := make([]float64, len(reserves))
		return probs
	}

	probs := make([]float64, len(reserves))
	for i, r := range reserves {
		x := tmF - float64(r)
		probs[i] = (x * x) / (tmF * tmF)
	}
	return probs
}

// OutcomeLabel returns a human-readable label for an outcome index.
func OutcomeLabel(marketType uint8, index int) string {
	switch marketType {
	case constants.MarketTypeBinary:
		if index == 0 {
			return "Yes"
		}
		return "No"
	case constants.MarketTypeContinuous:
		return fmt.Sprintf("Bin %d", index)
	default:
		return fmt.Sprintf("Outcome %d", index)
	}
}

// FormatPubkey formats a public key with truncation.
func FormatPubkey(pk solana.PublicKey) string {
	s := pk.String()
	if len(s) > 12 {
		return s[:12] + "..."
	}
	return s
}

// FormatTimestamp formats a unix timestamp as a UTC string.
func FormatTimestamp(unix int64) string {
	t := time.Unix(unix, 0).UTC()
	return t.Format("2006-01-02 15:04:05 UTC")
}
