package screens

import (
	"context"
	"fmt"

	"goperator-cli/internal/constants"
	"goperator-cli/internal/state"
	"goperator-cli/internal/tui/styles"
	"goperator-cli/internal/util"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/huh"
	"github.com/gagliardetto/solana-go"
)

type fundUserScreen struct {
	state             *state.SessionState
	form              *huh.Form
	phase             Phase
	userChoice        string
	sourceChoice      string
	manualChoice      string
	marketChoice      string
	networkMintChoice string
	mintStr           string
	amount            string
	mint              solana.PublicKey
	isSolTransfer     bool
	networkMints      []solana.PublicKey
	result            string
	err               error
}

const (
	phaseFundUser Phase = iota
	phaseFundSource
	phaseFundManualChoice
	phaseFundMintInput
	phaseFundNetworkLoad
	phaseFundNetworkSelect
	phaseFundMarketSelect
	phaseFundAmount
	phaseFundExec
	phaseFundDone
)

type mintsLoadedMsg struct {
	mints []solana.PublicKey
	err   error
}

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
		m.state.LogError("Fund User", msg.err)
		m.phase = phaseFundDone
		return m, nil

	case doneMsg:
		m.result = msg.result
		m.phase = phaseFundDone
		return m, nil

	case mintsLoadedMsg:
		if msg.err != nil {
			m.err = msg.err
			m.phase = phaseFundDone
			return m, nil
		}
		m.networkMints = msg.mints
		if len(msg.mints) == 0 {
			m.err = fmt.Errorf("no token mints found on the network")
			m.phase = phaseFundDone
			return m, nil
		}
		return m, m.advanceToNetworkSelect()
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
			switch m.sourceChoice {
			case "Cancel":
				return m, returnToMenu(nil)
			case "manual":
				return m, m.advanceToManualChoice()
			case "network":
				m.phase = phaseFundNetworkLoad
				return m, m.loadNetworkMints()
			case "market":
				return m, m.advanceToMarketSelect()
			}
		}
		return m, cmd

	case phaseFundManualChoice:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			switch m.manualChoice {
			case "Cancel":
				return m, returnToMenu(nil)
			case "sol":
				m.isSolTransfer = true
				m.amount = "10"
				return m, m.advanceToAmount()
			case "mint":
				return m, m.advanceToMintInput()
			}
		}
		return m, cmd

	case phaseFundMintInput:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			pk, err := solana.PublicKeyFromBase58(m.mintStr)
			if err != nil {
				m.err = fmt.Errorf("invalid mint address: %s", m.mintStr)
				m.phase = phaseFundDone
				return m, nil
			}
			m.mint = pk
			return m, m.advanceToAmount()
		}
		return m, cmd

	case phaseFundNetworkSelect:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			if m.networkMintChoice == "Cancel" {
				return m, returnToMenu(nil)
			}
			pk, _ := solana.PublicKeyFromBase58(m.networkMintChoice)
			m.mint = pk
			return m, m.advanceToAmount()
		}
		return m, cmd

	case phaseFundMarketSelect:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			if m.marketChoice == "Cancel" {
				return m, returnToMenu(nil)
			}
			market := resolveMarketChoice(m.state, m.marketChoice)
			if market == nil {
				return m, returnToMenu(nil)
			}
			m.mint = market.Mint
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
	opts := []huh.Option[string]{
		huh.NewOption("Enter mint address / Native SOL", "manual"),
		huh.NewOption("Browse network tokens", "network"),
	}
	if len(m.state.Markets) > 0 {
		opts = append(opts, huh.NewOption("From market collateral", "market"))
	}
	opts = append(opts, huh.NewOption("Cancel", "Cancel"))

	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("Token source").
				Options(opts...).
				Value(&m.sourceChoice),
		),
	)
	m.phase = phaseFundSource
	return m.form.Init()
}

func (m *fundUserScreen) advanceToManualChoice() tea.Cmd {
	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("Select token type").
				Options(
					huh.NewOption("Native SOL (transfer)", "sol"),
					huh.NewOption("Enter mint address", "mint"),
					huh.NewOption("Cancel", "Cancel"),
				).
				Value(&m.manualChoice),
		),
	)
	m.phase = phaseFundManualChoice
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
	m.phase = phaseFundMintInput
	return m.form.Init()
}

func (m *fundUserScreen) loadNetworkMints() tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		mints, err := m.state.Client.GetNetworkMints(ctx)
		return mintsLoadedMsg{mints: mints, err: err}
	}
}

func (m *fundUserScreen) advanceToNetworkSelect() tea.Cmd {
	opts := make([]huh.Option[string], 0, len(m.networkMints)+1)
	for _, mint := range m.networkMints {
		addr := mint.String()
		opts = append(opts, huh.NewOption(addr, addr))
	}
	opts = append(opts, huh.NewOption("Cancel", "Cancel"))

	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title(fmt.Sprintf("Select token mint (%d found)", len(m.networkMints))).
				Options(opts...).
				Value(&m.networkMintChoice),
		),
	)
	m.phase = phaseFundNetworkSelect
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
	m.phase = phaseFundMarketSelect
	return m.form.Init()
}

func (m *fundUserScreen) advanceToAmount() tea.Cmd {
	title := "Amount (tokens)"
	if m.isSolTransfer {
		title = "Amount (SOL)"
	}
	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewInput().
				Title(title).
				Value(&m.amount).
				Placeholder(m.amount),
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

		if m.isSolTransfer {
			// Parse SOL amount to lamports
			solFloat := 0.0
			fmt.Sscanf(m.amount, "%f", &solFloat)
			lamports := uint64(solFloat * 1_000_000_000)

			sig, err := m.state.Client.TransferSOL(ctx, m.state.Superuser.Keypair, user.Pubkey, lamports)
			if err != nil {
				return errMsg{err: fmt.Errorf("transfer SOL: %w", err)}
			}

			// Get new balance
			balance, err := m.state.Client.GetSOLBalance(ctx, user.Pubkey)
			if err != nil {
				return doneMsg{result: fmt.Sprintf("Transferred %s SOL to %s", m.amount, m.userChoice), sig: sig}
			}

			solBal := float64(balance) / 1_000_000_000
			return doneMsg{
				result: fmt.Sprintf("Transferred %s SOL to %s (balance: %.4f SOL)", m.amount, m.userChoice, solBal),
				sig:    sig,
			}
		}

		// SPL token
		amount := util.ParseTokenAmount(m.amount)

		if m.mint == constants.NativeMint {
			// Wrapped SOL: can't mint the native mint — wrap SOL instead
			lamports := amount * 1000 // convert 6-decimal token amount to 9-decimal lamports
			ata, err := m.state.Client.WrapSOL(ctx, m.state.Superuser.Keypair, user.Pubkey, lamports)
			if err != nil {
				return errMsg{err: fmt.Errorf("wrap SOL: %w", err)}
			}

			balance, err := m.state.Client.GetTokenBalance(ctx, ata)
			if err != nil {
				return doneMsg{result: fmt.Sprintf("Wrapped %s SOL to %s", m.amount, m.userChoice), sig: solana.Signature{}}
			}

			return doneMsg{
				result: fmt.Sprintf("Wrapped %s SOL to %s (WSOL balance: %s)",
					m.amount, m.userChoice, util.FormatTokenAmount(balance)),
				sig: solana.Signature{},
			}
		}

		ata, err := m.state.Client.GetOrCreateATA(ctx, m.state.Superuser.Keypair, user.Pubkey, m.mint)
		if err != nil {
			return errMsg{err: fmt.Errorf("create ATA: %w", err)}
		}

		err = m.state.Client.MintTo(ctx, m.state.Superuser.Keypair, m.mint, ata, amount)
		if err != nil {
			return errMsg{err: fmt.Errorf("mint tokens: %w", err)}
		}

		balance, err := m.state.Client.GetTokenBalance(ctx, ata)
		if err != nil {
			return doneMsg{result: fmt.Sprintf("Funded %s with %s tokens", m.userChoice, m.amount), sig: solana.Signature{}}
		}

		return doneMsg{
			result: fmt.Sprintf("Funded %s with %s tokens (balance: %s)",
				m.userChoice, m.amount, util.FormatTokenAmount(balance)),
			sig: solana.Signature{},
		}
	}
}

func (m *fundUserScreen) View() string {
	title := styles.StyleTitle.Render("  Fund User\n\n")
	switch m.phase {
	case phaseFundUser, phaseFundSource, phaseFundManualChoice, phaseFundMintInput,
		phaseFundNetworkSelect, phaseFundMarketSelect, phaseFundAmount:
		return title + m.form.View()
	case phaseFundNetworkLoad:
		return title + styles.StyleDim.Render("  Fetching token mints from network...")
	case phaseFundExec:
		if m.isSolTransfer {
			return title + styles.StyleDim.Render("  Transferring SOL...")
		}
		if m.mint == constants.NativeMint {
			return title + styles.StyleDim.Render("  Wrapping SOL...")
		}
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
