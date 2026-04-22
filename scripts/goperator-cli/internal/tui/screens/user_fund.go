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
	sourceChoice string
	marketChoice string
	mintStr      string
	amount       string
	mint         solana.PublicKey
	result       string
	err          error
}

const (
	phaseFundUser Phase = iota
	phaseFundSource
	phaseFundMarket
	phaseFundAmount
	phaseFundExec
	phaseFundDone
)

func NewFundUserScreen(s *state.SessionState) tea.Model {
	if len(s.Users) == 0 {
		return &fundUserScreen{state: s, phase: phaseFundDone, err: fmt.Errorf("no users available. Add a user first")}
	}

	amount := "100"
	if s.RandomMode {
		amount = s.Rand.FundAmount()
	}
	m := &fundUserScreen{state: s, amount: amount}

	userChoices := buildUserChoices(s, false, true)
	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("Select user to fund").
				Options(toHuhOptions(userChoices)...).
				Value(&m.userChoice),
		),
	)
	m.phase = phaseFundUser
	return m
}

func (m *fundUserScreen) Init() tea.Cmd {
	if m.form == nil {
		return nil
	}
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
		m.state.AddTxLog("Fund User", msg.sig, true, m.amount+" USDC -> "+m.userChoice)
		m.result = fmt.Sprintf("Funded %s with %s USDC", m.userChoice, m.amount)
		m.phase = phaseFundDone
		return m, nil
	}

	switch m.phase {
	case phaseFundUser:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			if m.userChoice == "Cancel" {
				return m, returnToMenu(nil)
			}
			return m, m.advanceToSource()
		}
		return m, cmd

	case phaseFundSource:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			if m.sourceChoice == "Cancel" {
				return m, returnToMenu(nil)
			}
			if m.sourceChoice == "manual" {
				return m, m.advanceToMintInput()
			}
			return m, m.advanceToMarketSelect()
		}
		return m, cmd

	case phaseFundMarket:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			if m.marketChoice == "Cancel" {
				return m, returnToMenu(nil)
			}
			// Resolve mint from market or from manual input
			if m.sourceChoice == "manual" {
				pk, err := solana.PublicKeyFromBase58(m.mintStr)
				if err != nil {
					m.err = fmt.Errorf("invalid mint address: %s", m.mintStr)
					m.phase = phaseFundDone
					return m, nil
				}
				m.mint = pk
			} else {
				market := resolveMarketChoice(m.state, m.marketChoice)
				if market == nil {
					return m, returnToMenu(nil)
				}
				m.mint = market.Mint
			}
			return m, m.advanceToAmount()
		}
		return m, cmd

	case phaseFundAmount:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			m.phase = phaseFundExec
			return m, m.execFund()
		}
		return m, cmd
	}

	return m, nil
}

func (m *fundUserScreen) advanceToSource() tea.Cmd {
	if len(m.state.Markets) == 0 {
		// No markets — skip to manual mint input
		m.sourceChoice = "manual"
		return m.advanceToMintInput()
	}
	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("Token source").
				Options(
					huh.NewOption("From market collateral", "market"),
					huh.NewOption("Enter mint address", "manual"),
					huh.NewOption("Cancel", "Cancel"),
				).
				Value(&m.sourceChoice),
		),
	)
	m.phase = phaseFundSource
	return m.form.Init()
}

func (m *fundUserScreen) advanceToMarketSelect() tea.Cmd {
	marketChoices := buildMarketChoices(m.state)
	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("Select market (for collateral mint)").
				Options(toHuhOptions(marketChoices)...).
				Value(&m.marketChoice),
		),
	)
	m.phase = phaseFundMarket
	return m.form.Init()
}

func (m *fundUserScreen) advanceToMintInput() tea.Cmd {
	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewInput().
				Title("Token mint address").
				Value(&m.mintStr).
				Placeholder("Enter base58 mint address"),
		),
	)
	m.phase = phaseFundMarket // reuse the same phase for form completion
	return m.form.Init()
}

func (m *fundUserScreen) advanceToAmount() tea.Cmd {
	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewInput().
				Title("Amount (USDC)").
				Value(&m.amount).
				Placeholder("100"),
		),
	)
	m.phase = phaseFundAmount
	return m.form.Init()
}

func (m *fundUserScreen) execFund() tea.Cmd {
	return func() tea.Msg {
		user := resolveUserChoice(m.state, m.userChoice, false)
		if user == nil {
			return errMsg{err: fmt.Errorf("invalid selection")}
		}

		ctx := context.Background()
		amount := util.ParseTokenAmount(m.amount)

		// Get or create ATA
		ata, err := m.state.Client.GetOrCreateATA(ctx, m.state.Superuser.Keypair, user.Pubkey, m.mint)
		if err != nil {
			return errMsg{err: fmt.Errorf("create ATA: %w", err)}
		}

		// Mint tokens
		err = m.state.Client.MintTo(ctx, m.state.Superuser.Keypair, m.mint, ata, amount)
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
	title := styles.StyleTitle.Render("  Fund User\n\n")
	switch m.phase {
	case phaseFundUser, phaseFundSource, phaseFundMarket, phaseFundAmount:
		return title + m.form.View()
	case phaseFundExec:
		return title + styles.StyleDim.Render("  Minting tokens...")
	case phaseFundDone:
		if m.err != nil {
			return title + styles.StyleError.Render("  "+m.err.Error()) +
				"\n\n" + styles.StyleDim.Render("  Press Esc to return")
		}
		return title + styles.StyleSuccess.Render("  "+m.result) +
			"\n\n" + styles.StyleDim.Render("  Press Esc to return")
	}
	return ""
}
