package screens

import (
	"context"
	"fmt"
	"math/big"

	"goperator-cli/internal/chain"
	"goperator-cli/internal/constants"
	"goperator-cli/internal/state"
	"goperator-cli/internal/tui/styles"
	"goperator-cli/internal/util"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/huh"
	"github.com/gagliardetto/solana-go"
)

// ── Add Liquidity ───────────────────────────────────────────────────────────

type addLPScreen struct {
	state        *state.SessionState
	form         *huh.Form
	phase        Phase
	marketChoice string
	amount       string
	userChoice   string
	market       *state.SessionMarket
	result       string
	err          error
}

const (
	phaseAddLPMarket Phase = iota
	phaseAddLPParams
	phaseAddLPUser
	phaseAddLPExec
	phaseAddLPDone
)

func NewAddLPScreen(s *state.SessionState) tea.Model {
	if len(s.Markets) == 0 {
		return &addLPScreen{state: s, phase: phaseAddLPDone, err: fmt.Errorf("no markets available")}
	}

	amount := "50"
	if s.RandomMode {
		amount = s.Rand.Liquidity()
	}
	m := &addLPScreen{state: s, amount: amount}
	marketChoices := buildMarketChoices(s)

	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("Select market to add liquidity").
				Options(toHuhOptions(marketChoices)...).
				Value(&m.marketChoice),
			huh.NewInput().
				Title("Amount (USDC) to add").
				Value(&m.amount).
				Placeholder("50"),
		),
	)
	return m
}

func (m *addLPScreen) Init() tea.Cmd {
	if m.form == nil {
		return nil
	}
	return m.form.Init()
}

func (m *addLPScreen) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if msg.String() == "esc" {
			return m, returnToMenu(nil)
		}

	case errMsg:
		m.err = msg.err
		m.phase = phaseAddLPDone
		return m, nil

	case doneMsg:
		m.state.AddTxLog("Add LP", msg.sig, true, m.amount+" USDC")
		m.result = fmt.Sprintf("Added %s USDC liquidity", m.amount)
		m.phase = phaseAddLPDone
		return m, nil
	}

	switch m.phase {
	case phaseAddLPMarket:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			if m.marketChoice == "Cancel" {
				return m, returnToMenu(nil)
			}
			m.market = resolveMarketChoice(m.state, m.marketChoice)
			// Move to user selection
			userChoices := buildUserChoices(m.state, true, true)
			m.form = huh.NewForm(
				huh.NewGroup(
					huh.NewSelect[string]().
						Title("Add liquidity as").
						Options(toHuhOptions(userChoices)...).
						Value(&m.userChoice),
				),
			)
			m.phase = phaseAddLPUser
			return m, m.form.Init()
		}
		return m, cmd

	case phaseAddLPUser:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			if m.userChoice == "Cancel" {
				return m, returnToMenu(nil)
			}
			m.phase = phaseAddLPExec
			return m, m.execAddLP()
		}
		return m, cmd
	}

	return m, nil
}

func (m *addLPScreen) execAddLP() tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		user := resolveUserChoice(m.state, m.userChoice, true)
		if user == nil || m.market == nil {
			return errMsg{err: fmt.Errorf("invalid selection")}
		}

		marketPda, _ := chain.FindMarket(m.market.ID, m.state.ProgramID)
		vaultAuthority, _ := chain.FindVaultAuthority(marketPda, m.state.ProgramID)
		lpPosition, _ := chain.FindLpPosition(marketPda, user.Pubkey, m.state.ProgramID)

		md, _, err := m.state.FetchMarket(m.market.ID)
		if err != nil {
			return errMsg{err: err}
		}

		providerAta, err := m.state.Client.GetOrCreateATA(ctx, m.state.Superuser.Keypair, user.Pubkey, md.CollateralMint)
		if err != nil {
			return errMsg{err: fmt.Errorf("create ATA: %w", err)}
		}

		amount := util.ParseTokenAmount(m.amount)
		args := chain.EncodeU64LE(amount)

		accounts := solana.AccountMetaSlice{
			{PublicKey: user.Pubkey, IsSigner: true, IsWritable: true},
			{PublicKey: marketPda, IsSigner: false, IsWritable: true},
			{PublicKey: lpPosition, IsSigner: false, IsWritable: true},
			{PublicKey: vaultAuthority, IsSigner: false, IsWritable: false},
			{PublicKey: md.Vault, IsSigner: false, IsWritable: true},
			{PublicKey: providerAta, IsSigner: false, IsWritable: true},
			{PublicKey: constants.TokenProgramID, IsSigner: false, IsWritable: false},
			{PublicKey: constants.SystemProgramID, IsSigner: false, IsWritable: false},
		}

		ix := chain.BuildInstruction(m.state.ProgramID, constants.DiscAddLiquidity, args, accounts)
		sig, err := m.state.Client.SendAndConfirm(ctx, []solana.Instruction{ix}, []solana.PrivateKey{user.Keypair}, user.Pubkey)
		if err != nil {
			return errMsg{err: err}
		}

		return doneMsg{result: m.amount + " USDC", sig: sig}
	}
}

func (m *addLPScreen) View() string {
	title := styles.StyleTitle.Render("  Add Liquidity\n\n")
	switch m.phase {
	case phaseAddLPMarket, phaseAddLPParams, phaseAddLPUser:
		return title + m.form.View()
	case phaseAddLPExec:
		return title + styles.StyleDim.Render("  Adding liquidity...")
	case phaseAddLPDone:
		if m.err != nil {
			return title + styles.StyleError.Render("  ✗ "+m.err.Error()) +
				"\n\n" + styles.StyleDim.Render("  Press Esc to return")
		}
		return title + styles.StyleSuccess.Render("  ✓ "+m.result) +
			"\n\n" + styles.StyleDim.Render("  Press Esc to return")
	}
	return ""
}

// ── Remove Liquidity ────────────────────────────────────────────────────────

type removeLPScreen struct {
	state        *state.SessionState
	form         *huh.Form
	phase        Phase
	marketChoice string
	userChoice   string
	sharesStr    string
	market       *state.SessionMarket
	result       string
	err          error
}

const (
	phaseRemoveLPMarket Phase = iota + 10
	phaseRemoveLPUser
	phaseRemoveLPShares
	phaseRemoveLPExec
	phaseRemoveLPDone
)

func NewRemoveLPScreen(s *state.SessionState) tea.Model {
	if len(s.Markets) == 0 {
		return &removeLPScreen{state: s, phase: phaseRemoveLPDone, err: fmt.Errorf("no markets available")}
	}

	m := &removeLPScreen{state: s, sharesStr: "all"}
	marketChoices := buildMarketChoices(s)

	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("Select market to remove liquidity").
				Options(toHuhOptions(marketChoices)...).
				Value(&m.marketChoice),
		),
	)
	m.phase = phaseRemoveLPMarket
	return m
}

func (m *removeLPScreen) Init() tea.Cmd {
	if m.form == nil {
		return nil
	}
	return m.form.Init()
}

func (m *removeLPScreen) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if msg.String() == "esc" {
			return m, returnToMenu(nil)
		}

	case errMsg:
		m.err = msg.err
		m.phase = phaseRemoveLPDone
		return m, nil

	case doneMsg:
		m.state.AddTxLog("Remove LP", msg.sig, true, m.result)
		m.phase = phaseRemoveLPDone
		return m, nil
	}

	switch m.phase {
	case phaseRemoveLPMarket:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			if m.marketChoice == "Cancel" {
				return m, returnToMenu(nil)
			}
			m.market = resolveMarketChoice(m.state, m.marketChoice)
			userChoices := buildUserChoices(m.state, true, true)
			m.form = huh.NewForm(
				huh.NewGroup(
					huh.NewSelect[string]().
						Title("Remove liquidity as").
						Options(toHuhOptions(userChoices)...).
						Value(&m.userChoice),
				),
			)
			m.phase = phaseRemoveLPUser
			return m, m.form.Init()
		}
		return m, cmd

	case phaseRemoveLPUser:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			if m.userChoice == "Cancel" {
				return m, returnToMenu(nil)
			}
			m.form = huh.NewForm(
				huh.NewGroup(
					huh.NewInput().
						Title("Shares to burn (or 'all')").
						Value(&m.sharesStr).
						Placeholder("all"),
				),
			)
			m.phase = phaseRemoveLPShares
			return m, m.form.Init()
		}
		return m, cmd

	case phaseRemoveLPShares:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			m.phase = phaseRemoveLPExec
			return m, m.execRemoveLP()
		}
		return m, cmd
	}

	return m, nil
}

func (m *removeLPScreen) execRemoveLP() tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		user := resolveUserChoice(m.state, m.userChoice, true)
		if user == nil || m.market == nil {
			return errMsg{err: fmt.Errorf("invalid selection")}
		}

		marketPda, _ := chain.FindMarket(m.market.ID, m.state.ProgramID)
		vaultAuthority, _ := chain.FindVaultAuthority(marketPda, m.state.ProgramID)
		lpPosition, _ := chain.FindLpPosition(marketPda, user.Pubkey, m.state.ProgramID)

		md, _, err := m.state.FetchMarket(m.market.ID)
		if err != nil {
			return errMsg{err: err}
		}

		// Fetch LP position
		lp, _, err := m.state.FetchLpPosition(marketPda, user.Pubkey)
		if err != nil {
			return errMsg{err: fmt.Errorf("no LP position found")}
		}

		sharesToBurn := new(big.Int).Set(lp.Shares)
		if m.sharesStr != "all" {
			parsed, ok := new(big.Int).SetString(m.sharesStr, 10)
			if !ok {
				return errMsg{err: fmt.Errorf("invalid shares value")}
			}
			sharesToBurn = parsed
		}

		providerAta, err := m.state.Client.GetOrCreateATA(ctx, m.state.Superuser.Keypair, user.Pubkey, md.CollateralMint)
		if err != nil {
			return errMsg{err: fmt.Errorf("create ATA: %w", err)}
		}

		balanceBefore, _ := m.state.Client.GetTokenBalance(ctx, providerAta)

		args := chain.EncodeU128LE(sharesToBurn)

		accounts := solana.AccountMetaSlice{
			{PublicKey: user.Pubkey, IsSigner: true, IsWritable: true},
			{PublicKey: marketPda, IsSigner: false, IsWritable: true},
			{PublicKey: lpPosition, IsSigner: false, IsWritable: true},
			{PublicKey: vaultAuthority, IsSigner: false, IsWritable: false},
			{PublicKey: md.Vault, IsSigner: false, IsWritable: true},
			{PublicKey: providerAta, IsSigner: false, IsWritable: true},
			{PublicKey: constants.TokenProgramID, IsSigner: false, IsWritable: false},
		}

		ix := chain.BuildInstruction(m.state.ProgramID, constants.DiscRemoveLiquidity, args, accounts)
		sig, err := m.state.Client.SendAndConfirm(ctx, []solana.Instruction{ix}, []solana.PrivateKey{user.Keypair}, user.Pubkey)
		if err != nil {
			return errMsg{err: err}
		}

		balanceAfter, _ := m.state.Client.GetTokenBalance(ctx, providerAta)
		returned := balanceAfter - balanceBefore

		m.result = fmt.Sprintf("Removed LP — collateral returned: %s USDC", util.FormatTokenAmount(returned))
		return doneMsg{result: m.result, sig: sig}
	}
}

func (m *removeLPScreen) View() string {
	title := styles.StyleTitle.Render("  Remove Liquidity\n\n")
	switch m.phase {
	case phaseRemoveLPMarket, phaseRemoveLPUser, phaseRemoveLPShares:
		return title + m.form.View()
	case phaseRemoveLPExec:
		return title + styles.StyleDim.Render("  Removing liquidity...")
	case phaseRemoveLPDone:
		if m.err != nil {
			return title + styles.StyleError.Render("  ✗ "+m.err.Error()) +
				"\n\n" + styles.StyleDim.Render("  Press Esc to return")
		}
		return title + styles.StyleSuccess.Render("  ✓ "+m.result) +
			"\n\n" + styles.StyleDim.Render("  Press Esc to return")
	}
	return ""
}
