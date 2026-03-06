package components

import (
	"fmt"
	"strings"

	"goperator-cli/internal/state"
	"goperator-cli/internal/tui/styles"

	"github.com/charmbracelet/lipgloss"
)

// RenderTxLog renders the transaction log panel.
func RenderTxLog(txLog []state.TxLogEntry, width, height int) string {
	title := styles.StyleTitle.Render("Transaction Log (Ctrl+L to close)")
	if len(txLog) == 0 {
		return title + "\n\n" + styles.StyleDim.Render("  No transactions yet.")
	}

	lines := []string{title, ""}
	start := 0
	if len(txLog) > height-4 {
		start = len(txLog) - (height - 4)
	}

	for i := start; i < len(txLog); i++ {
		entry := txLog[i]
		timeStr := entry.Time.Format("15:04:05")
		var statusIcon string
		var statusStyle lipgloss.Style
		if entry.Success {
			statusIcon = "✓"
			statusStyle = styles.StyleSuccess
		} else {
			statusIcon = "✗"
			statusStyle = styles.StyleError
		}

		sigShort := entry.Sig
		if len(sigShort) > 16 {
			sigShort = sigShort[:16] + "..."
		}

		line := fmt.Sprintf("  %s %s %-20s %s",
			styles.StyleDim.Render(timeStr),
			statusStyle.Render(statusIcon),
			entry.Action,
			styles.StyleDim.Render(sigShort),
		)
		if entry.Detail != "" {
			line += "  " + styles.StyleDim.Render(entry.Detail)
		}
		lines = append(lines, line)
	}

	content := strings.Join(lines, "\n")

	return lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(styles.ColorSecondary).
		Width(width - 4).
		Height(height - 4).
		Padding(1, 2).
		Render(content)
}
