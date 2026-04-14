package styles

import (
	"fmt"

	"github.com/charmbracelet/lipgloss"
)

var (
	ColorPrimary   = lipgloss.Color("#7C3AED") // violet
	ColorSecondary = lipgloss.Color("#06B6D4") // cyan
	ColorSuccess   = lipgloss.Color("#22C55E") // green
	ColorError     = lipgloss.Color("#EF4444") // red
	ColorWarning   = lipgloss.Color("#F59E0B") // amber
	ColorDim       = lipgloss.Color("#6B7280") // gray
	ColorAccent    = lipgloss.Color("#EC4899") // pink (for random mode)
	ColorBg        = lipgloss.Color("#1E1E2E") // dark bg

	StyleTitle = lipgloss.NewStyle().
			Bold(true).
			Foreground(ColorSecondary).
			MarginBottom(1)

	StyleBanner = lipgloss.NewStyle().
			Bold(true).
			Foreground(ColorSecondary).
			Border(lipgloss.RoundedBorder()).
			BorderForeground(ColorSecondary).
			Padding(0, 2)

	StyleSuccess = lipgloss.NewStyle().
			Foreground(ColorSuccess).
			Bold(true)

	StyleError = lipgloss.NewStyle().
			Foreground(ColorError).
			Bold(true)

	StyleWarning = lipgloss.NewStyle().
			Foreground(ColorWarning)

	StyleDim = lipgloss.NewStyle().
			Foreground(ColorDim)

	StyleAccent = lipgloss.NewStyle().
			Foreground(ColorAccent).
			Bold(true)

	StyleKey = lipgloss.NewStyle().
			Foreground(ColorDim)

	StyleValue = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#E5E7EB"))

	StyleStatusBar = lipgloss.NewStyle().
			Foreground(lipgloss.Color("#E5E7EB")).
			Background(lipgloss.Color("#374151")).
			Padding(0, 1)

	StyleSelected = lipgloss.NewStyle().
			Foreground(ColorPrimary).
			Bold(true)

	StyleMenuItem = lipgloss.NewStyle().
			PaddingLeft(2)

	StyleSectionHeader = lipgloss.NewStyle().
				Foreground(ColorDim).
				Bold(true).
				PaddingLeft(1)
)

// ProbBarColor returns a color for a probability value (red -> yellow -> green gradient).
func ProbBarColor(prob float64) lipgloss.Color {
	if prob < 0.2 {
		return lipgloss.Color("#EF4444") // red
	} else if prob < 0.4 {
		return lipgloss.Color("#F97316") // orange
	} else if prob < 0.6 {
		return lipgloss.Color("#F59E0B") // amber
	} else if prob < 0.8 {
		return lipgloss.Color("#84CC16") // lime
	}
	return lipgloss.Color("#22C55E") // green
}

// ProbBar renders a colored probability bar.
func ProbBar(prob float64, width int) string {
	filled := int(prob * float64(width))
	if filled > width {
		filled = width
	}
	color := ProbBarColor(prob)
	bar := lipgloss.NewStyle().Foreground(color).Render(repeat("█", filled))
	empty := lipgloss.NewStyle().Foreground(ColorDim).Render(repeat("░", width-filled))
	pct := lipgloss.NewStyle().Foreground(color).Render(
		fmt.Sprintf(" %5.1f%%", prob*100),
	)
	return bar + empty + pct
}

func repeat(s string, n int) string {
	if n <= 0 {
		return ""
	}
	result := ""
	for i := 0; i < n; i++ {
		result += s
	}
	return result
}
