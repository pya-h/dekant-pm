package screens

import (
	"context"
	"fmt"
	"math"
	"strconv"

	"goperator-cli/internal/chain"
	"goperator-cli/internal/constants"
	"goperator-cli/internal/state"
	"goperator-cli/internal/tui/styles"
	"goperator-cli/internal/util"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/huh"
	"github.com/gagliardetto/solana-go"
)

// ── Resolve Market ──────────────────────────────────────────────────────────

type resolveScreen struct {
	state        *state.SessionState
	form         *huh.Form
	phase        Phase
	marketChoice string
	outcomeStr   string
	valueStr     string
	userChoice   string
	market       *state.SessionMarket
	result       string
	err          error
}

const (
	phaseResolveMarket Phase = iota
	phaseResolveParams
	phaseResolveUser
	phaseResolveExec
	phaseResolveDone
)

func NewResolveScreen(s *state.SessionState) tea.Model {
	if len(s.Markets) == 0 {
		return &resolveScreen{state: s, phase: phaseResolveDone, err: fmt.Errorf("no markets available")}
	}

	m := &resolveScreen{state: s}
	marketChoices := buildMarketChoices(s)

	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("Select market to resolve").
				Options(toHuhOptions(marketChoices)...).
				Value(&m.marketChoice),
		),
	)
	return m
}

func (m *resolveScreen) Init() tea.Cmd { return m.form.Init() }

func (m *resolveScreen) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if msg.String() == "esc" {
			return m, returnToMenu(nil)
		}

	case errMsg:
		m.err = msg.err
		m.phase = phaseResolveDone
		return m, nil

	case doneMsg:
		m.state.AddTxLog("Resolve", msg.sig, true, m.result)
		m.phase = phaseResolveDone
		return m, nil
	}

	switch m.phase {
	case phaseResolveMarket:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			if m.marketChoice == "Cancel" {
				return m, returnToMenu(nil)
			}
			m.market = resolveMarketChoice(m.state, m.marketChoice)
			if m.market == nil {
				return m, returnToMenu(nil)
			}
			return m, m.buildParamsForm()
		}
		return m, cmd

	case phaseResolveParams:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			userChoices := buildUserChoices(m.state, true, true)
			m.form = huh.NewForm(
				huh.NewGroup(
					huh.NewSelect[string]().
						Title("Resolve as (must be oracle)").
						Options(toHuhOptions(userChoices)...).
						Value(&m.userChoice),
				),
			)
			m.phase = phaseResolveUser
			return m, m.form.Init()
		}
		return m, cmd

	case phaseResolveUser:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			if m.userChoice == "Cancel" {
				return m, returnToMenu(nil)
			}
			m.phase = phaseResolveExec
			return m, m.execResolve()
		}
		return m, cmd
	}

	return m, nil
}

func (m *resolveScreen) buildParamsForm() tea.Cmd {
	if m.market.Type == constants.MarketTypeContinuous {
		m.form = huh.NewForm(
			huh.NewGroup(
				huh.NewInput().
					Title(fmt.Sprintf("Resolved value (range: %.0f–%.0f)", m.market.RangeMin, m.market.RangeMax)).
					Value(&m.valueStr),
			),
		)
	} else {
		outcomeOpts := make([]huh.Option[string], m.market.NumOutcomes)
		for i := 0; i < m.market.NumOutcomes; i++ {
			label := util.OutcomeLabel(m.market.Type, i)
			outcomeOpts[i] = huh.NewOption(label, strconv.Itoa(i))
		}
		m.form = huh.NewForm(
			huh.NewGroup(
				huh.NewSelect[string]().
					Title("Winning outcome").
					Options(outcomeOpts...).
					Value(&m.outcomeStr),
			),
		)
	}
	m.phase = phaseResolveParams
	return m.form.Init()
}

func (m *resolveScreen) execResolve() tea.Cmd {
	user := resolveUserChoice(m.state, m.userChoice, true)
	if user == nil {
		return returnToMenu(nil)
	}

	marketPda, _ := chain.FindMarket(m.market.ID, m.state.ProgramID)

	var outcome uint16
	var value int64

	if m.market.Type == constants.MarketTypeContinuous {
		v, _ := strconv.ParseFloat(m.valueStr, 64)
		value = int64(math.Round(v * float64(constants.SCALE)))
		outcome = 0
	} else {
		o, _ := strconv.Atoi(m.outcomeStr)
		outcome = uint16(o)
		value = 0
	}

	args := make([]byte, 0)
	args = append(args, chain.EncodeU16LE(outcome)...)
	args = append(args, chain.EncodeI64LE(value)...)

	accounts := solana.AccountMetaSlice{
		{PublicKey: user.Pubkey, IsSigner: true, IsWritable: true},
		{PublicKey: marketPda, IsSigner: false, IsWritable: true},
	}

	m.result = fmt.Sprintf("Market #%d resolved", m.market.ID)

	return sendTx(
		m.state.Client, m.state.ProgramID,
		constants.DiscResolveMarket, args, accounts,
		[]solana.PrivateKey{user.Keypair},
		user.Pubkey,
		"Resolve Market",
	)
}

func (m *resolveScreen) View() string {
	title := styles.StyleTitle.Render("  Resolve Market\n\n")
	switch m.phase {
	case phaseResolveMarket, phaseResolveParams, phaseResolveUser:
		return title + m.form.View()
	case phaseResolveExec:
		return title + styles.StyleDim.Render("  Resolving market...")
	case phaseResolveDone:
		if m.err != nil {
			return title + styles.StyleError.Render("  ✗ "+m.err.Error()) +
				"\n\n" + styles.StyleDim.Render("  Press Esc to return")
		}
		return title + styles.StyleSuccess.Render("  ✓ "+m.result) +
			"\n\n" + styles.StyleDim.Render("  Press Esc to return")
	}
	return ""
}

// ── Claim Payout ────────────────────────────────────────────────────────────

type claimScreen struct {
	state        *state.SessionState
	form         *huh.Form
	phase        Phase
	marketChoice string
	userChoice   string
	market       *state.SessionMarket
	result       string
	err          error
}

const (
	phaseClaimMarket Phase = iota + 20
	phaseClaimUser
	phaseClaimExec
	phaseClaimDone
)

func NewClaimScreen(s *state.SessionState) tea.Model {
	if len(s.Markets) == 0 {
		return &claimScreen{state: s, phase: phaseClaimDone, err: fmt.Errorf("no markets available")}
	}

	m := &claimScreen{state: s}
	marketChoices := buildMarketChoices(s)

	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("Select resolved market to claim from").
				Options(toHuhOptions(marketChoices)...).
				Value(&m.marketChoice),
		),
	)
	m.phase = phaseClaimMarket
	return m
}

func (m *claimScreen) Init() tea.Cmd { return m.form.Init() }

func (m *claimScreen) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if msg.String() == "esc" {
			return m, returnToMenu(nil)
		}

	case errMsg:
		m.err = msg.err
		m.phase = phaseClaimDone
		return m, nil

	case doneMsg:
		m.state.AddTxLog("Claim", msg.sig, true, m.result)
		m.phase = phaseClaimDone
		return m, nil
	}

	switch m.phase {
	case phaseClaimMarket:
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
						Title("Claim as").
						Options(toHuhOptions(userChoices)...).
						Value(&m.userChoice),
				),
			)
			m.phase = phaseClaimUser
			return m, m.form.Init()
		}
		return m, cmd

	case phaseClaimUser:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			if m.userChoice == "Cancel" {
				return m, returnToMenu(nil)
			}
			m.phase = phaseClaimExec
			return m, m.execClaim()
		}
		return m, cmd
	}

	return m, nil
}

func (m *claimScreen) execClaim() tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		user := resolveUserChoice(m.state, m.userChoice, true)
		if user == nil || m.market == nil {
			return errMsg{err: fmt.Errorf("invalid selection")}
		}

		marketPda, _ := chain.FindMarket(m.market.ID, m.state.ProgramID)
		protocolConfig, _ := chain.FindProtocolConfig(m.state.ProgramID)
		vaultAuthority, _ := chain.FindVaultAuthority(marketPda, m.state.ProgramID)
		userPosition, _ := chain.FindUserPosition(marketPda, user.Pubkey, m.state.ProgramID)

		md, _, err := m.state.FetchMarket(m.market.ID)
		if err != nil {
			return errMsg{err: err}
		}

		traderAta, err := m.state.Client.GetOrCreateATA(ctx, m.state.Superuser.Keypair, user.Pubkey, md.CollateralMint)
		if err != nil {
			return errMsg{err: fmt.Errorf("create ATA: %w", err)}
		}

		balanceBefore, _ := m.state.Client.GetTokenBalance(ctx, traderAta)

		accounts := solana.AccountMetaSlice{
			{PublicKey: user.Pubkey, IsSigner: true, IsWritable: true},
			{PublicKey: marketPda, IsSigner: false, IsWritable: true},
			{PublicKey: protocolConfig, IsSigner: false, IsWritable: true},
			{PublicKey: userPosition, IsSigner: false, IsWritable: true},
			{PublicKey: vaultAuthority, IsSigner: false, IsWritable: false},
			{PublicKey: md.Vault, IsSigner: false, IsWritable: true},
			{PublicKey: traderAta, IsSigner: false, IsWritable: true},
			{PublicKey: constants.TokenProgramID, IsSigner: false, IsWritable: false},
		}

		ix := chain.BuildInstruction(m.state.ProgramID, constants.DiscClaimPayout, nil, accounts)
		sig, err := m.state.Client.SendAndConfirm(ctx, []solana.Instruction{ix}, []solana.PrivateKey{user.Keypair}, user.Pubkey)
		if err != nil {
			return errMsg{err: err}
		}

		balanceAfter, _ := m.state.Client.GetTokenBalance(ctx, traderAta)
		payout := balanceAfter - balanceBefore

		m.result = fmt.Sprintf("Payout: %s USDC (balance: %s → %s)",
			util.FormatTokenAmount(payout),
			util.FormatTokenAmount(balanceBefore), util.FormatTokenAmount(balanceAfter))
		return doneMsg{result: m.result, sig: sig}
	}
}

func (m *claimScreen) View() string {
	title := styles.StyleTitle.Render("  Claim Payout\n\n")
	switch m.phase {
	case phaseClaimMarket, phaseClaimUser:
		return title + m.form.View()
	case phaseClaimExec:
		return title + styles.StyleDim.Render("  Claiming payout...")
	case phaseClaimDone:
		if m.err != nil {
			return title + styles.StyleError.Render("  ✗ "+m.err.Error()) +
				"\n\n" + styles.StyleDim.Render("  Press Esc to return")
		}
		return title + styles.StyleSuccess.Render("  ✓ "+m.result) +
			"\n\n" + styles.StyleDim.Render("  Press Esc to return")
	}
	return ""
}

// ── Collect Fees ────────────────────────────────────────────────────────────

type collectFeesScreen struct {
	state        *state.SessionState
	form         *huh.Form
	phase        Phase
	marketChoice string
	market       *state.SessionMarket
	result       string
	err          error
}

const (
	phaseFeesMarket Phase = iota + 30
	phaseFeesExec
	phaseFeesDone
)

func NewCollectFeesScreen(s *state.SessionState) tea.Model {
	if len(s.Markets) == 0 {
		return &collectFeesScreen{state: s, phase: phaseFeesDone, err: fmt.Errorf("no markets available")}
	}

	m := &collectFeesScreen{state: s}
	marketChoices := buildMarketChoices(s)

	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("Select market to collect fees from").
				Options(toHuhOptions(marketChoices)...).
				Value(&m.marketChoice),
		),
	)
	m.phase = phaseFeesMarket
	return m
}

func (m *collectFeesScreen) Init() tea.Cmd { return m.form.Init() }

func (m *collectFeesScreen) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if msg.String() == "esc" {
			return m, returnToMenu(nil)
		}

	case errMsg:
		m.err = msg.err
		m.phase = phaseFeesDone
		return m, nil

	case doneMsg:
		m.state.AddTxLog("Collect Fees", msg.sig, true, m.result)
		m.phase = phaseFeesDone
		return m, nil
	}

	switch m.phase {
	case phaseFeesMarket:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			if m.marketChoice == "Cancel" {
				return m, returnToMenu(nil)
			}
			m.market = resolveMarketChoice(m.state, m.marketChoice)
			m.phase = phaseFeesExec
			return m, m.execCollectFees()
		}
		return m, cmd
	}

	return m, nil
}

func (m *collectFeesScreen) execCollectFees() tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		if m.market == nil {
			return errMsg{err: fmt.Errorf("invalid market")}
		}

		marketPda, _ := chain.FindMarket(m.market.ID, m.state.ProgramID)
		protocolConfig, _ := chain.FindProtocolConfig(m.state.ProgramID)
		vaultAuthority, _ := chain.FindVaultAuthority(marketPda, m.state.ProgramID)

		md, _, err := m.state.FetchMarket(m.market.ID)
		if err != nil {
			return errMsg{err: err}
		}

		pc, err := m.state.FetchProtocolConfig()
		if err != nil {
			return errMsg{err: err}
		}

		if md.ProtocolFeeAccumulated == 0 {
			return errMsg{err: fmt.Errorf("no fees to collect")}
		}

		treasuryAta, err := m.state.Client.GetOrCreateATA(ctx, m.state.Superuser.Keypair, pc.Treasury, md.CollateralMint)
		if err != nil {
			return errMsg{err: fmt.Errorf("create treasury ATA: %w", err)}
		}

		accounts := solana.AccountMetaSlice{
			{PublicKey: m.state.Superuser.Pubkey, IsSigner: true, IsWritable: true},
			{PublicKey: protocolConfig, IsSigner: false, IsWritable: false},
			{PublicKey: marketPda, IsSigner: false, IsWritable: true},
			{PublicKey: vaultAuthority, IsSigner: false, IsWritable: false},
			{PublicKey: md.Vault, IsSigner: false, IsWritable: true},
			{PublicKey: treasuryAta, IsSigner: false, IsWritable: true},
			{PublicKey: constants.TokenProgramID, IsSigner: false, IsWritable: false},
		}

		ix := chain.BuildInstruction(m.state.ProgramID, constants.DiscCollectFees, nil, accounts)
		sig, err := m.state.Client.SendAndConfirm(ctx, []solana.Instruction{ix},
			[]solana.PrivateKey{m.state.Superuser.Keypair}, m.state.Superuser.Pubkey)
		if err != nil {
			return errMsg{err: err}
		}

		m.result = fmt.Sprintf("Collected %s USDC fees from Market #%d",
			util.FormatTokenAmount(md.ProtocolFeeAccumulated), m.market.ID)
		return doneMsg{result: m.result, sig: sig}
	}
}

func (m *collectFeesScreen) View() string {
	title := styles.StyleTitle.Render("  Collect Fees\n\n")
	switch m.phase {
	case phaseFeesMarket:
		return title + m.form.View()
	case phaseFeesExec:
		return title + styles.StyleDim.Render("  Collecting fees (superuser)...")
	case phaseFeesDone:
		if m.err != nil {
			return title + styles.StyleError.Render("  ✗ "+m.err.Error()) +
				"\n\n" + styles.StyleDim.Render("  Press Esc to return")
		}
		return title + styles.StyleSuccess.Render("  ✓ "+m.result) +
			"\n\n" + styles.StyleDim.Render("  Press Esc to return")
	}
	return ""
}
