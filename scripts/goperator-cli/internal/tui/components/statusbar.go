package components

import (
	"fmt"

	"goperator-cli/internal/state"
	"goperator-cli/internal/tui"

	"github.com/charmbracelet/lipgloss"
)

// RenderStatusBar renders the persistent footer status bar.
func RenderStatusBar(s *state.SessionState, width int) string {
	network := tui.StyleDim.Render("Network: ") + "localhost"

	randomLabel := tui.StyleDim.Render("Random: ")
	var randomValue string
	if s.RandomMode {
		randomValue = tui.StyleAccent.Render("ON")
	} else {
		randomValue = tui.StyleDim.Render("OFF")
	}

	users := tui.StyleDim.Render(fmt.Sprintf("Users: %d", len(s.Users)))
	markets := tui.StyleDim.Render(fmt.Sprintf("Markets: %d", len(s.Markets)))
	txCount := tui.StyleDim.Render(fmt.Sprintf("TXs: %d", len(s.TxLog)))

	content := fmt.Sprintf(" %s │ %s%s │ %s │ %s │ %s │ Ctrl+R: Random  Ctrl+L: TxLog  Esc: Menu ",
		network, randomLabel, randomValue, users, markets, txCount)

	return lipgloss.NewStyle().
		Background(lipgloss.Color("#374151")).
		Foreground(lipgloss.Color("#E5E7EB")).
		Width(width).
		Render(content)
}
