package components

import (
	"fmt"
	"strings"

	"goperator-cli/internal/state"
	"goperator-cli/internal/tui"

	"github.com/charmbracelet/lipgloss"
)

// RenderTxLog renders the transaction log panel.
func RenderTxLog(txLog []state.TxLogEntry, width, height int) string {
	title := tui.StyleTitle.Render("Transaction Log (Ctrl+L to close)")
	if len(txLog) == 0 {
		return title + "\n\n" + tui.StyleDim.Render("  No transactions yet.")
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
			statusStyle = tui.StyleSuccess
		} else {
			statusIcon = "✗"
			statusStyle = tui.StyleError
		}

		sigShort := entry.Sig
		if len(sigShort) > 16 {
			sigShort = sigShort[:16] + "..."
		}

		line := fmt.Sprintf("  %s %s %-20s %s",
			tui.StyleDim.Render(timeStr),
			statusStyle.Render(statusIcon),
			entry.Action,
			tui.StyleDim.Render(sigShort),
		)
		if entry.Detail != "" {
			line += "  " + tui.StyleDim.Render(entry.Detail)
		}
		lines = append(lines, line)
	}

	content := strings.Join(lines, "\n")

	return lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(tui.ColorSecondary).
		Width(width - 4).
		Height(height - 4).
		Padding(1, 2).
		Render(content)
}
