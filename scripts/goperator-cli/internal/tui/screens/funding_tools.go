package screens

import (
	"goperator-cli/internal/state"
	"goperator-cli/internal/tui/styles"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/huh"
)

type fundingToolsScreen struct {
	state    *state.SessionState
	form     *huh.Form
	phase    Phase
	choice   string
	subModel tea.Model
	err      error
}

const (
	phaseFundingMenu Phase = iota + 200
	phaseFundingSub
	phaseFundingDone
)

func NewFundingToolsScreen(s *state.SessionState) tea.Model {
	m := &fundingToolsScreen{state: s}

	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("Funding Tools").
				Options(
					huh.NewOption("Fund User", "fund-user"),
					huh.NewOption("Charge Superuser (Airdrop SOL)", "charge-super"),
					huh.NewOption("Create SPL Token", "create-token"),
					huh.NewOption("Back", "back"),
				).
				Value(&m.choice),
		),
	)
	m.phase = phaseFundingMenu
	return m
}

func (m *fundingToolsScreen) Init() tea.Cmd {
	return m.form.Init()
}

func (m *fundingToolsScreen) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	// If we have an active sub-screen, delegate to it
	if m.phase == phaseFundingSub && m.subModel != nil {
		var cmd tea.Cmd
		m.subModel, cmd = m.subModel.Update(msg)
		return m, cmd
	}

	switch msg := msg.(type) {
	case tea.KeyMsg:
		if msg.String() == "esc" && m.phase == phaseFundingMenu {
			return m, returnToMenu(nil)
		}
	}

	if m.phase == phaseFundingMenu {
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			switch m.choice {
			case "back":
				return m, returnToMenu(nil)
			case "fund-user":
				m.subModel = NewFundUserScreen(m.state)
				m.phase = phaseFundingSub
				return m, m.subModel.Init()
			case "charge-super":
				m.subModel = NewSuperuserAirdropScreen(m.state)
				m.phase = phaseFundingSub
				return m, m.subModel.Init()
			case "create-token":
				m.subModel = NewCreateTokenScreen(m.state)
				m.phase = phaseFundingSub
				return m, m.subModel.Init()
			}
		}
		return m, cmd
	}

	return m, nil
}

func (m *fundingToolsScreen) View() string {
	if m.phase == phaseFundingSub && m.subModel != nil {
		return m.subModel.View()
	}

	title := styles.StyleTitle.Render("  Funding Tools\n\n")

	switch m.phase {
	case phaseFundingMenu:
		return title + m.form.View()
	case phaseFundingDone:
		if m.err != nil {
			return title + styles.StyleError.Render("  "+m.err.Error()) +
				"\n\n" + styles.StyleDim.Render("  Press Esc to return")
		}
	}
	return title
}
