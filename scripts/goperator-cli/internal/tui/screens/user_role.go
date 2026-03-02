package screens

import (
	"fmt"

	"goperator-cli/internal/chain"
	"goperator-cli/internal/constants"
	"goperator-cli/internal/state"
	"goperator-cli/internal/tui"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/huh"
	"github.com/gagliardetto/solana-go"
)

type assignRoleScreen struct {
	state      *state.SessionState
	form       *huh.Form
	phase      Phase
	userChoice string
	roleChoice string
	result     string
	err        error
}

const (
	phaseRoleForm Phase = iota
	phaseRoleExec
	phaseRoleDone
)

func NewAssignRoleScreen(s *state.SessionState) tea.Model {
	if len(s.Users) == 0 {
		return &assignRoleScreen{state: s, phase: phaseRoleDone, err: fmt.Errorf("no users available. Add a user first")}
	}

	userChoices := buildUserChoices(s, false, true)
	m := &assignRoleScreen{state: s}

	form := huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("Select user to assign role").
				Options(toHuhOptions(userChoices)...).
				Value(&m.userChoice),
			huh.NewSelect[string]().
				Title("Select role").
				Options(
					huh.NewOption("Oracle", "Oracle"),
					huh.NewOption("Creator", "Creator"),
					huh.NewOption("Admin", "Admin"),
				).
				Value(&m.roleChoice),
		),
	)

	m.form = form
	return m
}

func (m *assignRoleScreen) Init() tea.Cmd {
	return m.form.Init()
}

func (m *assignRoleScreen) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if msg.String() == "esc" {
			return m, returnToMenu(nil)
		}

	case errMsg:
		m.err = msg.err
		m.phase = phaseRoleDone
		return m, nil

	case doneMsg:
		user := resolveUserChoice(m.state, m.userChoice, false)
		if user != nil {
			roleName := m.roleChoice
			hasRole := false
			for _, r := range user.Roles {
				if r == roleName {
					hasRole = true
					break
				}
			}
			if !hasRole {
				user.Roles = append(user.Roles, roleName)
			}
		}
		m.state.AddTxLog("Assign Role", msg.sig, true, m.roleChoice+" → "+m.userChoice)
		m.result = fmt.Sprintf("%s role assigned to %s", m.roleChoice, m.userChoice)
		m.phase = phaseRoleDone
		return m, nil
	}

	if m.phase == phaseRoleForm {
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}

		if m.form.State == huh.StateCompleted {
			if m.userChoice == "Cancel" {
				return m, returnToMenu(nil)
			}
			m.phase = phaseRoleExec
			return m, m.execAssignRole()
		}
		return m, cmd
	}

	return m, nil
}

func (m *assignRoleScreen) execAssignRole() tea.Cmd {
	user := resolveUserChoice(m.state, m.userChoice, false)
	if user == nil {
		return returnToMenu(nil)
	}

	roleMap := map[string]uint8{"Oracle": constants.RoleOracle, "Creator": constants.RoleCreator, "Admin": constants.RoleAdmin}
	role := roleMap[m.roleChoice]

	protocolConfig, _ := chain.FindProtocolConfig(m.state.ProgramID)
	userRole, _ := chain.FindUserRole(user.Pubkey, role, m.state.ProgramID)

	args := chain.EncodeU8(role)

	accounts := solana.AccountMetaSlice{
		{PublicKey: m.state.Superuser.Pubkey, IsSigner: true, IsWritable: true},
		{PublicKey: protocolConfig, IsSigner: false, IsWritable: false},
		{PublicKey: m.state.ProgramID, IsSigner: false, IsWritable: false}, // authorityRole = null (program ID placeholder)
		{PublicKey: user.Pubkey, IsSigner: false, IsWritable: false},
		{PublicKey: userRole, IsSigner: false, IsWritable: true},
		{PublicKey: constants.SystemProgramID, IsSigner: false, IsWritable: false},
	}

	return sendTx(
		m.state.Client, m.state.ProgramID,
		constants.DiscAssignRole, args, accounts,
		[]solana.PrivateKey{m.state.Superuser.Keypair},
		m.state.Superuser.Pubkey,
		"Assign Role",
	)
}

func (m *assignRoleScreen) View() string {
	switch m.phase {
	case phaseRoleForm:
		return tui.StyleTitle.Render("  Assign Role\n\n") + m.form.View()
	case phaseRoleExec:
		return tui.StyleTitle.Render("  Assign Role\n\n") +
			tui.StyleDim.Render("  Assigning role...")
	case phaseRoleDone:
		if m.err != nil {
			return tui.StyleTitle.Render("  Assign Role\n\n") +
				tui.StyleError.Render("  ✗ "+m.err.Error()) +
				"\n\n" + tui.StyleDim.Render("  Press Esc to return")
		}
		return tui.StyleTitle.Render("  Assign Role\n\n") +
			tui.StyleSuccess.Render("  ✓ "+m.result) +
			"\n\n" + tui.StyleDim.Render("  Press Esc to return")
	}
	return ""
}

// toHuhOptions converts string slice to huh.Option slice.
func toHuhOptions(choices []string) []huh.Option[string] {
	opts := make([]huh.Option[string], len(choices))
	for i, c := range choices {
		opts[i] = huh.NewOption(c, c)
	}
	return opts
}
