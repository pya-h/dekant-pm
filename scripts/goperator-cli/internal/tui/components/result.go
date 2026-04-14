package components

import (
	"fmt"

	"goperator-cli/internal/tui/styles"
)

// RenderSuccess renders a success message.
func RenderSuccess(msg string) string {
	return styles.StyleSuccess.Render("  ✓ " + msg)
}

// RenderError renders an error message.
func RenderError(err error) string {
	return styles.StyleError.Render("  ✗ Error: " + ExtractError(err))
}

// RenderWarning renders a warning message.
func RenderWarning(msg string) string {
	return styles.StyleWarning.Render("  ⚠ " + msg)
}

// RenderInfo renders an info message.
func RenderInfo(msg string) string {
	return styles.StyleDim.Render("  " + msg)
}

// RenderKV renders key-value rows.
func RenderKV(rows [][]string) string {
	if len(rows) == 0 {
		return ""
	}
	maxKey := 0
	for _, r := range rows {
		if len(r[0]) > maxKey {
			maxKey = len(r[0])
		}
	}
	result := ""
	for _, r := range rows {
		key := styles.StyleKey.Render(fmt.Sprintf("  %-*s", maxKey, r[0]))
		val := styles.StyleValue.Render("  " + r[1])
		result += key + val + "\n"
	}
	return result
}

// ExtractError extracts a clean error message from an Anchor/Solana error.
func ExtractError(err error) string {
	msg := err.Error()
	if len(msg) > 200 {
		return msg[:200] + "..."
	}
	return msg
}
