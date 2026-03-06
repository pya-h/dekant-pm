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

type addUserScreen struct {
	state    *state.SessionState
	form     *huh.Form
	phase    Phase
	label    string
	result   string
	err      error
	keypair  solana.PrivateKey
}

const (
	phaseAddUserForm Phase = iota
	phaseAddUserExec
	phaseAddUserDone
)

func NewAddUserScreen(s *state.SessionState) tea.Model {
	defaultLabel := s.NextUserLabel()

	label := defaultLabel
	form := huh.NewForm(
		huh.NewGroup(
			huh.NewInput().
				Title("User label").
				Value(&label).
				Placeholder(defaultLabel),
		),
	)

	return &addUserScreen{
		state: s,
		form:  form,
		label: defaultLabel,
	}
}

func (m *addUserScreen) Init() tea.Cmd {
	return m.form.Init()
}

func (m *addUserScreen) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if msg.String() == "esc" {
			return m, returnToMenu(nil)
		}

	case errMsg:
		m.err = msg.err
		m.phase = phaseAddUserDone
		return m, nil

	case doneMsg:
		label := m.label
		if label == "" {
			label = m.state.NextUserLabel()
		}

		m.state.Users = append(m.state.Users, state.User{
			Label:   label,
			Keypair: m.keypair,
			Pubkey:  m.keypair.PublicKey(),
			Roles:   []string{},
		})
		m.state.AddTxLog("Add User", solana.Signature{}, true, label)

		m.result = fmt.Sprintf("Created %s (%s) with 10 SOL",
			label, util.FormatPubkey(m.keypair.PublicKey()))
		m.phase = phaseAddUserDone
		return m, nil
	}

	// Form handling
	if m.phase == phaseAddUserForm {
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}

		if m.form.State == huh.StateCompleted {
			// Get form values
			m.label = m.form.GetString("User label")
			if m.label == "" {
				m.label = m.state.NextUserLabel()
			}
			m.phase = phaseAddUserExec
			return m, m.execAddUser()
		}

		return m, cmd
	}

	return m, nil
}

func (m *addUserScreen) execAddUser() tea.Cmd {
	return func() tea.Msg {
		kp, err := solana.NewRandomPrivateKey()
		if err != nil {
			return errMsg{err: fmt.Errorf("generate keypair: %w", err)}
		}
		m.keypair = kp

		ctx := context.Background()
		_, err = m.state.Client.RequestAirdrop(ctx, kp.PublicKey(), 10*solana.LAMPORTS_PER_SOL)
		if err != nil {
			// Still create user even if airdrop fails
			return doneMsg{result: "airdrop failed but user created"}
		}
		return doneMsg{result: "success"}
	}
}

func (m *addUserScreen) View() string {
	switch m.phase {
	case phaseAddUserForm:
		return styles.StyleTitle.Render("  Add New User\n\n") + m.form.View()
	case phaseAddUserExec:
		return styles.StyleTitle.Render("  Add New User\n\n") +
			styles.StyleDim.Render("  Generating keypair and airdropping SOL...")
	case phaseAddUserDone:
		if m.err != nil {
			return styles.StyleTitle.Render("  Add New User\n\n") +
				styles.StyleError.Render("  Error: "+m.err.Error()) +
				"\n\n" + styles.StyleDim.Render("  Press Esc to return")
		}
		return styles.StyleTitle.Render("  Add New User\n\n") +
			styles.StyleSuccess.Render("  ✓ "+m.result) +
			"\n\n" + styles.StyleDim.Render("  Press Esc to return")
	}
	return ""
}
