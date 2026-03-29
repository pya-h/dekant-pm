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

type superuserAirdropScreen struct {
	state   *state.SessionState
	form    *huh.Form
	phase   Phase
	amount  string
	result  string
	err     error
	balance string
}

const (
	phaseSuAirdropForm Phase = iota
	phaseSuAirdropExec
	phaseSuAirdropDone
)

type suBalanceMsg struct {
	balance uint64
	err     error
}

func NewSuperuserAirdropScreen(s *state.SessionState) tea.Model {
	amount := "10"

	form := huh.NewForm(
		huh.NewGroup(
			huh.NewInput().
				Title("Amount (SOL)").
				Key("amount").
				Value(&amount).
				Placeholder("10"),
		),
	)

	return &superuserAirdropScreen{
		state:  s,
		form:   form,
		amount: amount,
	}
}

func (m *superuserAirdropScreen) Init() tea.Cmd {
	return tea.Batch(m.form.Init(), m.fetchBalance())
}

func (m *superuserAirdropScreen) fetchBalance() tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		bal, err := m.state.Client.GetSOLBalance(ctx, m.state.Superuser.Pubkey)
		return suBalanceMsg{balance: bal, err: err}
	}
}

func (m *superuserAirdropScreen) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if msg.String() == "esc" {
			return m, returnToMenu(nil)
		}

	case suBalanceMsg:
		if msg.err == nil {
			sol := float64(msg.balance) / float64(solana.LAMPORTS_PER_SOL)
			m.balance = fmt.Sprintf("%.4f SOL", sol)
		}
		return m, nil

	case errMsg:
		m.err = msg.err
		m.phase = phaseSuAirdropDone
		return m, nil

	case doneMsg:
		m.result = msg.result
		m.phase = phaseSuAirdropDone
		return m, nil
	}

	// Form handling
	if m.phase == phaseSuAirdropForm {
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}

		if m.form.State == huh.StateCompleted {
			m.amount = m.form.GetString("amount")
			if m.amount == "" {
				m.amount = "10"
			}
			m.phase = phaseSuAirdropExec
			return m, m.execAirdrop()
		}

		return m, cmd
	}

	return m, nil
}

func (m *superuserAirdropScreen) execAirdrop() tea.Cmd {
	return func() tea.Msg {
		var solAmount float64
		if _, err := fmt.Sscanf(m.amount, "%f", &solAmount); err != nil || solAmount <= 0 {
			return errMsg{err: fmt.Errorf("invalid amount: %s", m.amount)}
		}

		lamports := uint64(solAmount * float64(solana.LAMPORTS_PER_SOL))
		ctx := context.Background()

		_, err := m.state.Client.RequestAirdrop(ctx, m.state.Superuser.Pubkey, lamports)
		if err != nil {
			return errMsg{err: fmt.Errorf("airdrop failed: %w", err)}
		}

		// Fetch new balance
		bal, _ := m.state.Client.GetSOLBalance(ctx, m.state.Superuser.Pubkey)
		newBal := fmt.Sprintf("%.4f SOL", float64(bal)/float64(solana.LAMPORTS_PER_SOL))

		return doneMsg{
			result: fmt.Sprintf("Airdropped %s SOL to superuser\n  New balance: %s", m.amount, newBal),
		}
	}
}

func (m *superuserAirdropScreen) View() string {
	title := styles.StyleTitle.Render("  Airdrop SOL to Superuser\n\n")
	info := styles.StyleDim.Render(fmt.Sprintf("  Superuser: %s\n", util.FormatPubkey(m.state.Superuser.Pubkey)))
	if m.balance != "" {
		info += styles.StyleDim.Render(fmt.Sprintf("  Balance: %s\n", m.balance))
	}
	info += "\n"

	switch m.phase {
	case phaseSuAirdropForm:
		return title + info + m.form.View()
	case phaseSuAirdropExec:
		return title + info +
			styles.StyleDim.Render("  Requesting airdrop...")
	case phaseSuAirdropDone:
		if m.err != nil {
			return title + info +
				styles.StyleError.Render("  Error: "+m.err.Error()) +
				"\n\n" + styles.StyleDim.Render("  Press Esc to return")
		}
		return title + info +
			styles.StyleSuccess.Render("  "+m.result) +
			"\n\n" + styles.StyleDim.Render("  Press Esc to return")
	}
	return ""
}
