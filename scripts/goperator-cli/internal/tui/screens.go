package tui

import (
	"goperator-cli/internal/state"
	"goperator-cli/internal/tui/screens"

	tea "github.com/charmbracelet/bubbletea"
)

// CreateActionScreen creates the appropriate screen model for an action.
func CreateActionScreen(action string, s *state.SessionState) tea.Model {
	switch action {
	case "add-user":
		return screens.NewAddUserScreen(s)
	case "assign-role":
		return screens.NewAssignRoleScreen(s)
	case "fund-user":
		return screens.NewFundUserScreen(s)
	case "create-market":
		return screens.NewCreateMarketScreen(s)
	case "pause-unpause":
		return screens.NewPauseUnpauseScreen(s)
	case "buy":
		return screens.NewTradeScreen(s, true)
	case "sell":
		return screens.NewTradeScreen(s, false)
	case "add-lp":
		return screens.NewAddLPScreen(s)
	case "remove-lp":
		return screens.NewRemoveLPScreen(s)
	case "resolve":
		return screens.NewResolveScreen(s)
	case "claim":
		return screens.NewClaimScreen(s)
	case "collect-fees":
		return screens.NewCollectFeesScreen(s)
	case "view-position":
		return screens.NewViewPositionScreen(s)
	case "query-market":
		return screens.NewQueryMarketScreen(s)
	case "view-balances":
		return screens.NewViewBalancesScreen(s)
	default:
		return nil
	}
}
