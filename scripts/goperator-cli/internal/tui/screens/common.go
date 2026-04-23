package screens

import (
	"context"
	"fmt"
	"strings"

	"goperator-cli/internal/chain"
	"goperator-cli/internal/constants"
	"goperator-cli/internal/state"
	"goperator-cli/internal/tui/types"
	"goperator-cli/internal/util"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/gagliardetto/solana-go"
)

// Phase represents the current phase of a multi-step screen.
type Phase int

// Common messages
type (
	errMsg  struct{ err error }
	doneMsg struct {
		result string
		sig    solana.Signature
	}
	dataMsg struct {
		data interface{}
	}
	// stepMsg provides real-time execution progress — each step appends a log
	// line and optionally triggers the next step via next.
	stepMsg struct {
		line string
		next tea.Cmd
	}
)

// returnToMenu sends ActionDoneMsg to return to main menu.
func returnToMenu(err error) tea.Cmd {
	return func() tea.Msg {
		return types.ActionDoneMsg{Err: err}
	}
}

// buildUserChoices builds user selection options for a form.
func buildUserChoices(s *state.SessionState, includeSuperuser, includeCancel bool) []string {
	choices := []string{}
	if includeSuperuser {
		choices = append(choices, fmt.Sprintf("Superuser (%s)", util.FormatPubkey(s.Superuser.Pubkey)))
	}
	for _, u := range s.Users {
		roles := ""
		if len(u.Roles) > 0 {
			roles = " [" + strings.Join(u.Roles, ", ") + "]"
		}
		choices = append(choices, fmt.Sprintf("%s (%s)%s", u.Label, util.FormatPubkey(u.Pubkey), roles))
	}
	if includeCancel {
		choices = append(choices, "Cancel")
	}
	return choices
}

// resolveUserChoice maps a user choice string back to the user.
func resolveUserChoice(s *state.SessionState, choice string, includeSuperuser bool) *state.User {
	if choice == "Cancel" {
		return nil
	}
	if includeSuperuser && strings.HasPrefix(choice, "Superuser") {
		return &s.Superuser
	}
	for i := range s.Users {
		if strings.HasPrefix(choice, s.Users[i].Label+" (") {
			return &s.Users[i]
		}
	}
	return nil
}

// buildMarketChoices builds market selection options with mint info.
func buildMarketChoices(s *state.SessionState) []string {
	choices := []string{}
	for _, m := range s.Markets {
		typeName := constants.MarketTypeNames[m.Type]
		mintInfo := util.FormatPubkey(m.Mint)
		if m.MintLabel != "" {
			mintInfo = m.MintLabel + " (" + mintInfo + ")"
		}
		choices = append(choices, fmt.Sprintf("#%d %s (%s) — %s", m.ID, m.Label, typeName, mintInfo))
	}
	choices = append(choices, "Cancel")
	return choices
}

// resolveMarketChoice maps a market choice string back to the market.
func resolveMarketChoice(s *state.SessionState, choice string) *state.SessionMarket {
	if choice == "Cancel" {
		return nil
	}
	for i := range s.Markets {
		prefix := fmt.Sprintf("#%d ", s.Markets[i].ID)
		if strings.HasPrefix(choice, prefix) {
			return &s.Markets[i]
		}
	}
	return nil
}

// sendTx is a helper to build and send a transaction as a tea.Cmd.
func sendTx(
	client *chain.Client,
	programID solana.PublicKey,
	disc [8]byte,
	args []byte,
	accounts solana.AccountMetaSlice,
	signers []solana.PrivateKey,
	payer solana.PublicKey,
	action string,
	preInstructions ...solana.Instruction,
) tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		ix := chain.BuildInstruction(programID, disc, args, accounts)
		instructions := make([]solana.Instruction, 0, len(preInstructions)+1)
		instructions = append(instructions, preInstructions...)
		instructions = append(instructions, ix)

		sig, err := client.SendAndConfirm(ctx, instructions, signers, payer)
		if err != nil {
			return errMsg{err: fmt.Errorf("%s: %w", action, err)}
		}
		return doneMsg{result: action, sig: sig}
	}
}
