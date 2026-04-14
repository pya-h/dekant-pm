package screens

import (
	"context"
	"fmt"

	"goperator-cli/internal/state"
	"goperator-cli/internal/tui/styles"
	"goperator-cli/internal/util"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/huh"
	"github.com/gagliardetto/solana-go"
)

type fundUserScreen struct {
	state        *state.SessionState
	form         *huh.Form
	phase        Phase
	userChoice   string
	marketChoice string
	amount       string
	result       string
	err          error
}

const (
	phaseFundForm Phase = iota
	phaseFundExec
	phaseFundDone
)

func NewFundUserScreen(s *state.SessionState) tea.Model {
	if len(s.Users) == 0 {
		return &fundUserScreen{state: s, phase: phaseFundDone, err: fmt.Errorf("no users available. Add a user first")}
	}
	if len(s.Markets) == 0 {
		return &fundUserScreen{state: s, phase: phaseFundDone, err: fmt.Errorf("no markets available. Create a market first")}
	}

	m := &fundUserScreen{state: s, amount: "100"}
	userChoices := buildUserChoices(s, false, true)
	marketChoices := buildMarketChoices(s)

	form := huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("Select user to fund").
				Options(toHuhOptions(userChoices)...).
				Value(&m.userChoice),
			huh.NewSelect[string]().
				Title("Select market (for collateral mint)").
				Options(toHuhOptions(marketChoices)...).
				Value(&m.marketChoice),
			huh.NewInput().
				Title("Amount (USDC)").
				Value(&m.amount).
				Placeholder("100"),
		),
	)

	m.form = form
	return m
}

func (m *fundUserScreen) Init() tea.Cmd {
	return m.form.Init()
}

func (m *fundUserScreen) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if msg.String() == "esc" {
			return m, returnToMenu(nil)
		}

	case errMsg:
		m.err = msg.err
		m.phase = phaseFundDone
		return m, nil

	case doneMsg:
		m.state.AddTxLog("Fund User", msg.sig, true, m.amount+" USDC → "+m.userChoice)
		m.result = fmt.Sprintf("Funded %s with %s USDC", m.userChoice, m.amount)
		m.phase = phaseFundDone
		return m, nil
	}

	if m.phase == phaseFundForm {
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}

		if m.form.State == huh.StateCompleted {
			if m.userChoice == "Cancel" || m.marketChoice == "Cancel" {
				return m, returnToMenu(nil)
			}
			m.phase = phaseFundExec
			return m, m.execFund()
		}
		return m, cmd
	}

	return m, nil
}

func (m *fundUserScreen) execFund() tea.Cmd {
	return func() tea.Msg {
		user := resolveUserChoice(m.state, m.userChoice, false)
		market := resolveMarketChoice(m.state, m.marketChoice)
		if user == nil || market == nil {
			return errMsg{err: fmt.Errorf("invalid selection")}
		}

		ctx := context.Background()
		amount := util.ParseTokenAmount(m.amount)

		// Get or create ATA
		ata, err := m.state.Client.GetOrCreateATA(ctx, m.state.Superuser.Keypair, user.Pubkey, market.Mint)
		if err != nil {
			return errMsg{err: fmt.Errorf("create ATA: %w", err)}
		}

		// Mint tokens
		err = m.state.Client.MintTo(ctx, m.state.Superuser.Keypair, market.Mint, ata, amount)
		if err != nil {
			return errMsg{err: fmt.Errorf("mint tokens: %w", err)}
		}

		// Get new balance
		balance, err := m.state.Client.GetTokenBalance(ctx, ata)
		if err != nil {
			return doneMsg{result: "funded (balance check failed)", sig: solana.Signature{}}
		}

		return doneMsg{
			result: fmt.Sprintf("Funded %s with %s USDC (balance: %s USDC)",
				m.userChoice, m.amount, util.FormatTokenAmount(balance)),
			sig: solana.Signature{},
		}
	}
}

func (m *fundUserScreen) View() string {
	switch m.phase {
	case phaseFundForm:
		return styles.StyleTitle.Render("  Fund User\n\n") + m.form.View()
	case phaseFundExec:
		return styles.StyleTitle.Render("  Fund User\n\n") +
			styles.StyleDim.Render("  Minting tokens...")
	case phaseFundDone:
		if m.err != nil {
			return styles.StyleTitle.Render("  Fund User\n\n") +
				styles.StyleError.Render("  ✗ "+m.err.Error()) +
				"\n\n" + styles.StyleDim.Render("  Press Esc to return")
		}
		return styles.StyleTitle.Render("  Fund User\n\n") +
			styles.StyleSuccess.Render("  ✓ "+m.result) +
			"\n\n" + styles.StyleDim.Render("  Press Esc to return")
	}
	return ""
}
