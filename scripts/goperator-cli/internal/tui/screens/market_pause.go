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

type pauseUnpauseScreen struct {
	state        *state.SessionState
	form         *huh.Form
	phase        Phase
	marketChoice string
	userChoice   string
	isPaused     bool
	result       string
	err          error
}

const (
	phasePauseMarketForm Phase = iota
	phasePauseUserForm
	phasePauseExec
	phasePauseDone
)

func NewPauseUnpauseScreen(s *state.SessionState) tea.Model {
	if len(s.Markets) == 0 {
		return &pauseUnpauseScreen{state: s, phase: phasePauseDone, err: fmt.Errorf("no markets available")}
	}

	m := &pauseUnpauseScreen{state: s}
	marketChoices := buildMarketChoices(s)

	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("Select market to pause/unpause").
				Options(toHuhOptions(marketChoices)...).
				Value(&m.marketChoice),
		),
	)
	return m
}

func (m *pauseUnpauseScreen) Init() tea.Cmd { return m.form.Init() }

func (m *pauseUnpauseScreen) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if msg.String() == "esc" {
			return m, returnToMenu(nil)
		}

	case errMsg:
		m.err = msg.err
		m.phase = phasePauseDone
		return m, nil

	case doneMsg:
		action := "paused"
		if m.isPaused {
			action = "unpaused"
		}
		m.state.AddTxLog("Pause/Unpause", msg.sig, true, action)
		m.result = fmt.Sprintf("Market %s", action)
		m.phase = phasePauseDone
		return m, nil

	case dataMsg:
		// Market data loaded, now show user form
		marketData := msg.data.(*state.MarketAccount)
		m.isPaused = marketData.State == constants.MarketStatePaused
		action := "Pause"
		if m.isPaused {
			action = "Unpause"
		}

		userChoices := buildUserChoices(m.state, true, true)
		m.form = huh.NewForm(
			huh.NewGroup(
				huh.NewSelect[string]().
					Title(action+" market as").
					Options(toHuhOptions(userChoices)...).
					Value(&m.userChoice),
			),
		)
		m.phase = phasePauseUserForm
		return m, m.form.Init()
	}

	switch m.phase {
	case phasePauseMarketForm:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			if m.marketChoice == "Cancel" {
				return m, returnToMenu(nil)
			}
			return m, m.loadMarketData()
		}
		return m, cmd

	case phasePauseUserForm:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			if m.userChoice == "Cancel" {
				return m, returnToMenu(nil)
			}
			m.phase = phasePauseExec
			return m, m.execPause()
		}
		return m, cmd
	}

	return m, nil
}

func (m *pauseUnpauseScreen) loadMarketData() tea.Cmd {
	return func() tea.Msg {
		market := resolveMarketChoice(m.state, m.marketChoice)
		if market == nil {
			return errMsg{err: fmt.Errorf("invalid market")}
		}
		marketData, _, err := m.state.FetchMarket(market.ID)
		if err != nil {
			return errMsg{err: err}
		}
		return dataMsg{data: marketData}
	}
}

func (m *pauseUnpauseScreen) execPause() tea.Cmd {
	market := resolveMarketChoice(m.state, m.marketChoice)
	user := resolveUserChoice(m.state, m.userChoice, true)
	if market == nil || user == nil {
		return returnToMenu(nil)
	}

	marketPda, _ := chain.FindMarket(market.ID, m.state.ProgramID)
	protocolConfig, _ := chain.FindProtocolConfig(m.state.ProgramID)

	// For superuser, authorityRole = program ID (null placeholder)
	authorityRole := m.state.ProgramID
	if user.Pubkey != m.state.Superuser.Pubkey {
		// Check if user has Admin role
		authorityRole, _ = chain.FindUserRole(user.Pubkey, constants.RoleAdmin, m.state.ProgramID)
	}

	accounts := solana.AccountMetaSlice{
		{PublicKey: user.Pubkey, IsSigner: true, IsWritable: true},
		{PublicKey: protocolConfig, IsSigner: false, IsWritable: false},
		{PublicKey: authorityRole, IsSigner: false, IsWritable: false},
		{PublicKey: marketPda, IsSigner: false, IsWritable: true},
	}

	disc := constants.DiscPauseMarket
	if m.isPaused {
		disc = constants.DiscUnpauseMarket
	}

	return sendTx(
		m.state.Client, m.state.ProgramID,
		disc, nil, accounts,
		[]solana.PrivateKey{user.Keypair},
		user.Pubkey,
		"Pause/Unpause",
	)
}

func (m *pauseUnpauseScreen) View() string {
	title := tui.StyleTitle.Render("  Pause / Unpause Market\n\n")
	switch m.phase {
	case phasePauseMarketForm, phasePauseUserForm:
		return title + m.form.View()
	case phasePauseExec:
		return title + tui.StyleDim.Render("  Sending transaction...")
	case phasePauseDone:
		if m.err != nil {
			return title + tui.StyleError.Render("  ✗ "+m.err.Error()) +
				"\n\n" + tui.StyleDim.Render("  Press Esc to return")
		}
		return title + tui.StyleSuccess.Render("  ✓ "+m.result) +
			"\n\n" + tui.StyleDim.Render("  Press Esc to return")
	}
	return ""
}
