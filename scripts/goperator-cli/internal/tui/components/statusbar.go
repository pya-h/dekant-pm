package components

import (
	"fmt"

	"goperator-cli/internal/state"
	"goperator-cli/internal/tui/styles"

	"github.com/charmbracelet/lipgloss"
)

// RenderStatusBar renders the persistent footer status bar.
func RenderStatusBar(s *state.SessionState, width int) string {
	network := styles.StyleDim.Render("Network: ") + "localhost"

	randomLabel := styles.StyleDim.Render("Random: ")
	var randomValue string
	if s.RandomMode {
		randomValue = styles.StyleAccent.Render("ON")
	} else {
		randomValue = styles.StyleDim.Render("OFF")
	}

	users := styles.StyleDim.Render(fmt.Sprintf("Users: %d", len(s.Users)))
	markets := styles.StyleDim.Render(fmt.Sprintf("Markets: %d", len(s.Markets)))
	txCount := styles.StyleDim.Render(fmt.Sprintf("TXs: %d", len(s.TxLog)))

	content := fmt.Sprintf(" %s │ %s%s │ %s │ %s │ %s │ Ctrl+R: Random  Ctrl+L: TxLog  Esc: Menu ",
		network, randomLabel, randomValue, users, markets, txCount)

	return lipgloss.NewStyle().
		Background(lipgloss.Color("#374151")).
		Foreground(lipgloss.Color("#E5E7EB")).
		Width(width).
		Render(content)
}
