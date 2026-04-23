package screens

import (
	"context"
	"fmt"
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

type createMarketScreen struct {
	state *state.SessionState
	form  *huh.Form
	phase Phase

	// Form values
	marketType    string
	liquidity     string
	deadline      string
	numOutcomes   string
	rangeMinStr   string
	rangeMaxStr   string
	oracleChoice  string
	creatorChoice string
	label         string

	// Mint selection
	mintSource        string // "new", "native", "address", "network", "market"
	mintStr           string
	networkMints      []solana.PublicKey
	networkMintChoice string
	marketMintChoice  string
	selectedMint      solana.PublicKey
	isNewMint         bool
	isNativeMint      bool
	mintLabel         string

	// Fund confirmation
	fundConfirm    string
	balanceShort   uint64 // how many more tokens needed
	currentBalance uint64

	// Execution log
	execLog []string

	result string
	err    error
}

const (
	phaseMarketTypeForm Phase = iota
	phaseMarketParamsForm
	phaseMarketOracleForm
	phaseMarketCreatorForm
	phaseMarketMintForm
	phaseMarketMintInput
	phaseMarketMintNetLoad
	phaseMarketMintNetSelect
	phaseMarketMintMarketSel
	phaseMarketBalanceCheck
	phaseMarketFundConfirm
	phaseMarketExec
	phaseMarketDone
)

func NewCreateMarketScreen(s *state.SessionState) tea.Model {
	m := &createMarketScreen{
		state:       s,
		liquidity:   "100",
		deadline:    "+1h",
		numOutcomes: "4",
		rangeMinStr: "50",
		rangeMaxStr: "500",
		execLog:     []string{},
	}

	if s.RandomMode {
		m.marketType = s.Rand.MarketType()
		m.liquidity = s.Rand.Liquidity()
		m.deadline = s.Rand.Deadline()
		m.numOutcomes = s.Rand.NumOutcomes(m.marketType)
		m.rangeMinStr, m.rangeMaxStr = s.Rand.RangeValues()
	}

	form := huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("Market type").
				Options(
					huh.NewOption("Binary (Yes/No)", "binary"),
					huh.NewOption("Multi-outcome", "multi"),
					huh.NewOption("Continuous (Range)", "continuous"),
				).
				Value(&m.marketType),
			huh.NewInput().
				Title("Initial liquidity (tokens)").
				Value(&m.liquidity).
				Placeholder("100"),
			huh.NewInput().
				Title("Deadline (+1h, +30m, +7d, ISO, unix)").
				Value(&m.deadline).
				Placeholder("+1h"),
		),
	)

	m.form = form
	m.phase = phaseMarketTypeForm
	return m
}

func (m *createMarketScreen) Init() tea.Cmd {
	return m.form.Init()
}

func (m *createMarketScreen) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if msg.String() == "esc" {
			return m, returnToMenu(nil)
		}

	case errMsg:
		m.execLog = append(m.execLog, styles.StyleError.Render("  ✗ "+msg.err.Error()))
		m.err = msg.err
		m.state.LogError("Create Market", msg.err)
		m.phase = phaseMarketDone
		return m, nil

	case doneMsg:
		m.state.AddTxLog("Create Market", msg.sig, true, m.result)
		m.phase = phaseMarketDone
		return m, nil

	case stepMsg:
		m.execLog = append(m.execLog, msg.line)
		if msg.next != nil {
			return m, msg.next
		}
		return m, nil

	case mintsLoadedMsg:
		if msg.err != nil {
			m.err = msg.err
			m.phase = phaseMarketDone
			return m, nil
		}
		m.networkMints = msg.mints
		if len(msg.mints) == 0 {
			m.err = fmt.Errorf("no token mints found on the network")
			m.phase = phaseMarketDone
			return m, nil
		}
		return m, m.advanceToMintNetSelect()

	case balanceCheckMsg:
		if msg.err != nil {
			m.err = msg.err
			m.phase = phaseMarketDone
			return m, nil
		}
		liquidityAmt := util.ParseTokenAmount(m.liquidity)
		m.currentBalance = msg.balance
		if msg.balance >= liquidityAmt {
			// Sufficient balance — proceed to exec
			m.execLog = append(m.execLog, styles.StyleSuccess.Render(fmt.Sprintf(
				"  ✓ Creator balance: %s tokens (sufficient)", util.FormatTokenAmount(msg.balance))))
			m.phase = phaseMarketExec
			return m, m.execCreateMarket(false)
		}
		// Insufficient — ask user
		m.balanceShort = liquidityAmt - msg.balance
		return m, m.advanceToFundConfirm()
	}

	// Phase-based form handling
	switch m.phase {
	case phaseMarketTypeForm:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			return m, m.advanceToParams()
		}
		return m, cmd

	case phaseMarketParamsForm:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			return m, m.advanceToOracle()
		}
		return m, cmd

	case phaseMarketOracleForm:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			if m.oracleChoice == "Cancel" {
				return m, returnToMenu(nil)
			}
			return m, m.advanceToCreator()
		}
		return m, cmd

	case phaseMarketCreatorForm:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			if m.creatorChoice == "Cancel" {
				return m, returnToMenu(nil)
			}
			return m, m.advanceToMintSource()
		}
		return m, cmd

	case phaseMarketMintForm:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			switch m.mintSource {
			case "Cancel":
				return m, returnToMenu(nil)
			case "new":
				m.isNewMint = true
				m.phase = phaseMarketExec
				return m, m.execCreateMarket(true)
			case "native":
				m.isNativeMint = true
				m.selectedMint = constants.NativeMint
				m.mintLabel = "Wrapped SOL"
				m.phase = phaseMarketBalanceCheck
				return m, m.checkBalance()
			case "address":
				return m, m.advanceToMintInput()
			case "network":
				m.phase = phaseMarketMintNetLoad
				return m, m.loadNetworkMints()
			case "market":
				return m, m.advanceToMintMarketSel()
			}
		}
		return m, cmd

	case phaseMarketMintInput:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			pk, err := solana.PublicKeyFromBase58(m.mintStr)
			if err != nil {
				m.err = fmt.Errorf("invalid mint address: %s", m.mintStr)
				m.phase = phaseMarketDone
				return m, nil
			}
			m.selectedMint = pk
			m.mintLabel = util.FormatPubkey(pk)
			m.phase = phaseMarketBalanceCheck
			return m, m.checkBalance()
		}
		return m, cmd

	case phaseMarketMintNetSelect:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			if m.networkMintChoice == "Cancel" {
				return m, returnToMenu(nil)
			}
			pk, _ := solana.PublicKeyFromBase58(m.networkMintChoice)
			m.selectedMint = pk
			m.mintLabel = m.findMintLabel(pk)
			m.phase = phaseMarketBalanceCheck
			return m, m.checkBalance()
		}
		return m, cmd

	case phaseMarketMintMarketSel:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			if m.marketMintChoice == "Cancel" {
				return m, returnToMenu(nil)
			}
			market := resolveMarketChoice(m.state, m.marketMintChoice)
			if market == nil {
				return m, returnToMenu(nil)
			}
			m.selectedMint = market.Mint
			if market.MintLabel != "" {
				m.mintLabel = market.MintLabel
			} else {
				m.mintLabel = fmt.Sprintf("Market#%d token", market.ID)
			}
			m.phase = phaseMarketBalanceCheck
			return m, m.checkBalance()
		}
		return m, cmd

	case phaseMarketFundConfirm:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			if m.fundConfirm == "no" {
				m.err = fmt.Errorf("insufficient balance (%s tokens, need %s)",
					util.FormatTokenAmount(m.currentBalance), m.liquidity)
				m.phase = phaseMarketDone
				return m, nil
			}
			m.phase = phaseMarketExec
			return m, m.execCreateMarket(true)
		}
		return m, cmd
	}

	return m, nil
}

// ── Phase advancement ───────────────────────────────────────────────────────

func (m *createMarketScreen) advanceToParams() tea.Cmd {
	switch m.marketType {
	case "multi":
		m.form = huh.NewForm(
			huh.NewGroup(
				huh.NewInput().
					Title("Number of outcomes (3-32)").
					Value(&m.numOutcomes).
					Placeholder("4"),
			),
		)
	case "continuous":
		m.form = huh.NewForm(
			huh.NewGroup(
				huh.NewInput().
					Title("Range min").
					Value(&m.rangeMinStr).
					Placeholder("50"),
				huh.NewInput().
					Title("Range max").
					Value(&m.rangeMaxStr).
					Placeholder("500"),
				huh.NewInput().
					Title("Number of bins (2-256)").
					Value(&m.numOutcomes).
					Placeholder("64"),
			),
		)
	default:
		// Binary — skip to oracle
		m.numOutcomes = "2"
		return m.advanceToOracle()
	}

	m.phase = phaseMarketParamsForm
	return m.form.Init()
}

func (m *createMarketScreen) advanceToOracle() tea.Cmd {
	userChoices := buildUserChoices(m.state, true, true)
	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("Select oracle for this market").
				Options(toHuhOptions(userChoices)...).
				Value(&m.oracleChoice),
		),
	)
	m.phase = phaseMarketOracleForm
	return m.form.Init()
}

func (m *createMarketScreen) advanceToCreator() tea.Cmd {
	typeName := m.marketType
	defaultLabel := fmt.Sprintf("Market #%d (%s)", len(m.state.Markets), typeName)
	m.label = defaultLabel

	userChoices := buildUserChoices(m.state, true, true)
	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewInput().
				Title("Market label").
				Value(&m.label).
				Placeholder(defaultLabel),
			huh.NewSelect[string]().
				Title("Create market as").
				Options(toHuhOptions(userChoices)...).
				Value(&m.creatorChoice),
		),
	)
	m.phase = phaseMarketCreatorForm
	return m.form.Init()
}

func (m *createMarketScreen) advanceToMintSource() tea.Cmd {
	opts := []huh.Option[string]{
		huh.NewOption("Create new SPL token", "new"),
		huh.NewOption("Native SOL (wrapped)", "native"),
		huh.NewOption("Enter mint address", "address"),
		huh.NewOption("Browse network tokens", "network"),
	}
	if len(m.state.Markets) > 0 {
		opts = append(opts, huh.NewOption("From market collateral", "market"))
	}
	opts = append(opts, huh.NewOption("Cancel", "Cancel"))

	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("Collateral token source").
				Options(opts...).
				Value(&m.mintSource),
		),
	)
	m.phase = phaseMarketMintForm
	return m.form.Init()
}

func (m *createMarketScreen) advanceToMintInput() tea.Cmd {
	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewInput().
				Title("Token mint address").
				Value(&m.mintStr).
				Placeholder("Enter base58 mint address"),
		),
	)
	m.phase = phaseMarketMintInput
	return m.form.Init()
}

func (m *createMarketScreen) advanceToMintNetSelect() tea.Cmd {
	opts := make([]huh.Option[string], 0, len(m.networkMints)+1)
	for _, mint := range m.networkMints {
		addr := mint.String()
		label := addr
		// Annotate known mints from session markets
		if knownLabel := m.findMintLabel(mint); knownLabel != "" {
			label = fmt.Sprintf("%s — %s", knownLabel, util.FormatPubkey(mint))
		}
		opts = append(opts, huh.NewOption(label, addr))
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
	m.phase = phaseMarketMintNetSelect
	return m.form.Init()
}

func (m *createMarketScreen) advanceToMintMarketSel() tea.Cmd {
	marketChoices := buildMarketChoices(m.state)
	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("Select market (for collateral mint)").
				Options(toHuhOptions(marketChoices)...).
				Value(&m.marketMintChoice),
		),
	)
	m.phase = phaseMarketMintMarketSel
	return m.form.Init()
}

func (m *createMarketScreen) advanceToFundConfirm() tea.Cmd {
	needed := util.ParseTokenAmount(m.liquidity)
	fundLabel := ""
	if m.isNativeMint {
		fundLabel = fmt.Sprintf(
			"Creator has %s wrapped SOL but needs %s. Wrap more SOL from superuser?",
			util.FormatTokenAmount(m.currentBalance), util.FormatTokenAmount(needed))
	} else {
		fundLabel = fmt.Sprintf(
			"Creator has %s tokens but needs %s. Auto-fund via mint?",
			util.FormatTokenAmount(m.currentBalance), util.FormatTokenAmount(needed))
	}

	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title(fundLabel).
				Options(
					huh.NewOption("Yes, fund the creator", "yes"),
					huh.NewOption("No, cancel", "no"),
				).
				Value(&m.fundConfirm),
		),
	)
	m.phase = phaseMarketFundConfirm
	return m.form.Init()
}

// ── Balance check ───────────────────────────────────────────────────────────

type balanceCheckMsg struct {
	balance uint64
	err     error
}

func (m *createMarketScreen) checkBalance() tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		creator := resolveUserChoice(m.state, m.creatorChoice, true)
		if creator == nil {
			return balanceCheckMsg{err: fmt.Errorf("invalid creator selection")}
		}
		ata := chain.DeriveATA(creator.Pubkey, m.selectedMint)
		balance, err := m.state.Client.GetTokenBalance(ctx, ata)
		if err != nil {
			// ATA doesn't exist → balance is 0
			return balanceCheckMsg{balance: 0}
		}
		return balanceCheckMsg{balance: balance}
	}
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// findMintLabel returns a human-readable label for a mint from session markets.
func (m *createMarketScreen) findMintLabel(mint solana.PublicKey) string {
	if mint == constants.NativeMint {
		return "Wrapped SOL"
	}
	for _, mkt := range m.state.Markets {
		if mkt.Mint == mint {
			if mkt.MintLabel != "" {
				return mkt.MintLabel
			}
			return fmt.Sprintf("Market#%d token", mkt.ID)
		}
	}
	return ""
}

func (m *createMarketScreen) loadNetworkMints() tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		mints, err := m.state.Client.GetNetworkMints(ctx)
		return mintsLoadedMsg{mints: mints, err: err}
	}
}

// ── Execution (step-by-step with logging) ───────────────────────────────────

// marketExecCtx carries state between execution steps.
type marketExecCtx struct {
	screen       *createMarketScreen
	oracle       *state.User
	creator      *state.User
	marketType   uint8
	numOutcomes  int
	liquidityAmt uint64
	deadlineUnix int64
	rangeMin     int64
	rangeMax     int64
	roleType     uint8
	marketID     uint64
	marketPda    solana.PublicKey
	mintPubkey   solana.PublicKey
	mintLabel    string
	creatorAta   solana.PublicKey
	needsFunding bool
}

func (m *createMarketScreen) execCreateMarket(doFunding bool) tea.Cmd {
	return func() tea.Msg {
		// Parse and validate inputs
		oracle := resolveUserChoice(m.state, m.oracleChoice, true)
		creator := resolveUserChoice(m.state, m.creatorChoice, true)
		if oracle == nil || creator == nil {
			return errMsg{err: fmt.Errorf("invalid user selection")}
		}

		var marketType uint8
		switch m.marketType {
		case "binary":
			marketType = constants.MarketTypeBinary
		case "multi":
			marketType = constants.MarketTypeMulti
		case "continuous":
			marketType = constants.MarketTypeContinuous
		}

		numOutcomes, _ := strconv.Atoi(m.numOutcomes)
		if numOutcomes < 2 {
			numOutcomes = 2
		}

		liquidityAmt := util.ParseTokenAmount(m.liquidity)
		deadlineUnix, err := util.ParseDeadline(m.deadline)
		if err != nil {
			return errMsg{err: fmt.Errorf("invalid deadline '%s': %w", m.deadline, err)}
		}

		var rangeMin, rangeMax int64
		if marketType == constants.MarketTypeContinuous {
			rMin, errMin := strconv.ParseFloat(m.rangeMinStr, 64)
			rMax, errMax := strconv.ParseFloat(m.rangeMaxStr, 64)
			if errMin != nil || errMax != nil {
				return errMsg{err: fmt.Errorf("invalid range values: min=%s, max=%s", m.rangeMinStr, m.rangeMaxStr)}
			}
			rangeMin = int64(rMin * float64(constants.SCALE))
			rangeMax = int64(rMax * float64(constants.SCALE))
		}

		// Derive creator role
		roleType := constants.RoleCreator
		if creator.Pubkey != m.state.Superuser.Pubkey {
			hasCreator := false
			for _, r := range creator.Roles {
				if r == "Creator" {
					hasCreator = true
					break
				}
			}
			if !hasCreator {
				for _, r := range creator.Roles {
					if r == "Admin" {
						roleType = constants.RoleAdmin
						break
					}
				}
			}
		}

		ec := &marketExecCtx{
			screen:       m,
			oracle:       oracle,
			creator:      creator,
			marketType:   marketType,
			numOutcomes:  numOutcomes,
			liquidityAmt: liquidityAmt,
			deadlineUnix: deadlineUnix,
			rangeMin:     rangeMin,
			rangeMax:     rangeMax,
			roleType:     roleType,
			needsFunding: doFunding,
		}

		return stepMsg{
			line: styles.StyleDim.Render("  ▸ Fetching protocol config..."),
			next: ec.stepFetchConfig(),
		}
	}
}

func (ec *marketExecCtx) stepFetchConfig() tea.Cmd {
	return func() tea.Msg {
		pc, err := ec.screen.state.FetchProtocolConfig()
		if err != nil {
			return errMsg{err: fmt.Errorf("fetch protocol config: %w", err)}
		}
		ec.marketID = pc.MarketCount

		return stepMsg{
			line: styles.StyleSuccess.Render(fmt.Sprintf("  ✓ Protocol config loaded — next market ID: %d", ec.marketID)),
			next: ec.stepResolveMint(),
		}
	}
}

func (ec *marketExecCtx) stepResolveMint() tea.Cmd {
	m := ec.screen
	if m.isNewMint {
		return ec.stepCreateNewMint()
	}
	// Existing mint already selected
	ec.mintPubkey = m.selectedMint
	ec.mintLabel = m.mintLabel
	return func() tea.Msg {
		return stepMsg{
			line: styles.StyleSuccess.Render(fmt.Sprintf(
				"  ✓ Using token: %s (%s)", ec.mintLabel, util.FormatPubkey(ec.mintPubkey))),
			next: ec.stepEnsureCreatorATA(),
		}
	}
}

func (ec *marketExecCtx) stepCreateNewMint() tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		mintPubkey, _, err := ec.screen.state.Client.CreateMint(ctx, ec.screen.state.Superuser.Keypair, constants.USDC_DECIMALS)
		if err != nil {
			return errMsg{err: fmt.Errorf("create SPL token: %w", err)}
		}
		ec.mintPubkey = mintPubkey
		ec.mintLabel = fmt.Sprintf("Market#%d Token", ec.marketID)

		return stepMsg{
			line: styles.StyleSuccess.Render(fmt.Sprintf(
				"  ✓ Created SPL token: %s (%s)", ec.mintLabel, util.FormatPubkey(mintPubkey))),
			next: ec.stepEnsureCreatorATA(),
		}
	}
}

func (ec *marketExecCtx) stepEnsureCreatorATA() tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		ata, err := ec.screen.state.Client.GetOrCreateATA(ctx, ec.screen.state.Superuser.Keypair, ec.creator.Pubkey, ec.mintPubkey)
		if err != nil {
			return errMsg{err: fmt.Errorf("create creator ATA: %w", err)}
		}
		ec.creatorAta = ata

		if ec.needsFunding {
			return stepMsg{
				line: styles.StyleSuccess.Render(fmt.Sprintf(
					"  ✓ Creator ATA ready (%s)", util.FormatPubkey(ata))),
				next: ec.stepFundCreator(),
			}
		}

		return stepMsg{
			line: styles.StyleSuccess.Render(fmt.Sprintf(
				"  ✓ Creator ATA ready (%s)", util.FormatPubkey(ata))),
			next: ec.stepSendCreateMarketTx(),
		}
	}
}

func (ec *marketExecCtx) stepFundCreator() tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		m := ec.screen

		if m.isNewMint {
			// New mint: fund 5x liquidity (superuser is authority)
			mintAmount := ec.liquidityAmt * 5
			err := m.state.Client.MintTo(ctx, m.state.Superuser.Keypair, ec.mintPubkey, ec.creatorAta, mintAmount)
			if err != nil {
				return errMsg{err: fmt.Errorf("mint tokens to creator: %w", err)}
			}
			return stepMsg{
				line: styles.StyleSuccess.Render(fmt.Sprintf(
					"  ✓ Minted %s tokens to creator (5x liquidity)", util.FormatTokenAmount(mintAmount))),
				next: ec.stepSendCreateMarketTx(),
			}
		}

		if m.isNativeMint {
			// Wrapped SOL: wrap the shortfall
			wrapAmount := ec.liquidityAmt
			if m.currentBalance > 0 {
				wrapAmount = ec.liquidityAmt - m.currentBalance
			}
			// Convert token amount to lamports (USDC_DECIMALS=6 → ×10^3 for SOL's 9 decimals)
			lamports := wrapAmount * 1000
			_, err := m.state.Client.WrapSOL(ctx, m.state.Superuser.Keypair, ec.creator.Pubkey, lamports)
			if err != nil {
				return errMsg{err: fmt.Errorf("wrap SOL for creator: %w", err)}
			}
			return stepMsg{
				line: styles.StyleSuccess.Render(fmt.Sprintf(
					"  ✓ Wrapped %s SOL to creator", util.FormatTokenAmount(wrapAmount))),
				next: ec.stepSendCreateMarketTx(),
			}
		}

		// Existing SPL token: mint the shortfall
		fundAmount := ec.liquidityAmt
		if m.currentBalance > 0 {
			fundAmount = ec.liquidityAmt - m.currentBalance
		}
		err := m.state.Client.MintTo(ctx, m.state.Superuser.Keypair, ec.mintPubkey, ec.creatorAta, fundAmount)
		if err != nil {
			return errMsg{err: fmt.Errorf("mint tokens to creator (superuser may not be mint authority): %w", err)}
		}
		newBalance := m.currentBalance + fundAmount
		return stepMsg{
			line: styles.StyleSuccess.Render(fmt.Sprintf(
				"  ✓ Funded creator with %s tokens (balance: %s)",
				util.FormatTokenAmount(fundAmount), util.FormatTokenAmount(newBalance))),
			next: ec.stepSendCreateMarketTx(),
		}
	}
}

func (ec *marketExecCtx) stepSendCreateMarketTx() tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		m := ec.screen

		// Derive PDAs
		marketPda, _ := chain.FindMarket(ec.marketID, m.state.ProgramID)
		ec.marketPda = marketPda
		vaultAuthority, _ := chain.FindVaultAuthority(marketPda, m.state.ProgramID)
		protocolConfig, _ := chain.FindProtocolConfig(m.state.ProgramID)
		oracleRolePda, _ := chain.FindUserRole(ec.oracle.Pubkey, constants.RoleOracle, m.state.ProgramID)
		creatorRolePda, _ := chain.FindUserRole(ec.creator.Pubkey, ec.roleType, m.state.ProgramID)
		creatorLpPos, _ := chain.FindLpPosition(marketPda, ec.creator.Pubkey, m.state.ProgramID)

		// Generate vault keypair
		vaultKp, err := solana.NewRandomPrivateKey()
		if err != nil {
			return errMsg{err: fmt.Errorf("generate vault keypair: %w", err)}
		}

		// Build instruction args
		args := make([]byte, 0)
		args = append(args, chain.EncodeU8(ec.marketType)...)
		args = append(args, chain.EncodeU16LE(uint16(ec.numOutcomes))...)
		args = append(args, chain.EncodeI64LE(ec.deadlineUnix)...)
		args = append(args, chain.EncodePubkey(ec.oracle.Pubkey)...)
		args = append(args, chain.EncodeU64LE(ec.liquidityAmt)...)
		args = append(args, chain.EncodeI64LE(ec.rangeMin)...)
		args = append(args, chain.EncodeI64LE(ec.rangeMax)...)

		accounts := solana.AccountMetaSlice{
			{PublicKey: ec.creator.Pubkey, IsSigner: true, IsWritable: true},
			{PublicKey: creatorRolePda, IsSigner: false, IsWritable: false},
			{PublicKey: protocolConfig, IsSigner: false, IsWritable: true},
			{PublicKey: oracleRolePda, IsSigner: false, IsWritable: false},
			{PublicKey: marketPda, IsSigner: false, IsWritable: true},
			{PublicKey: ec.mintPubkey, IsSigner: false, IsWritable: false},
			{PublicKey: vaultAuthority, IsSigner: false, IsWritable: false},
			{PublicKey: vaultKp.PublicKey(), IsSigner: true, IsWritable: true},
			{PublicKey: ec.creatorAta, IsSigner: false, IsWritable: true},
			{PublicKey: creatorLpPos, IsSigner: false, IsWritable: true},
			{PublicKey: constants.TokenProgramID, IsSigner: false, IsWritable: false},
			{PublicKey: constants.AssociatedTokenProgramID, IsSigner: false, IsWritable: false},
			{PublicKey: constants.SystemProgramID, IsSigner: false, IsWritable: false},
		}

		ix := chain.BuildInstruction(m.state.ProgramID, constants.DiscCreateMarket, args, accounts)
		signers := []solana.PrivateKey{ec.creator.Keypair, vaultKp}
		sig, err := m.state.Client.SendAndConfirm(ctx, []solana.Instruction{ix}, signers, ec.creator.Pubkey)
		if err != nil {
			return errMsg{err: fmt.Errorf("send create market tx: %w", err)}
		}

		// Track market in session
		var rangeMinF, rangeMaxF float64
		if ec.marketType == constants.MarketTypeContinuous {
			rMin, _ := strconv.ParseFloat(m.rangeMinStr, 64)
			rMax, _ := strconv.ParseFloat(m.rangeMaxStr, 64)
			rangeMinF = rMin
			rangeMaxF = rMax
		}

		m.state.Markets = append(m.state.Markets, state.SessionMarket{
			ID:          ec.marketID,
			Label:       m.label,
			Type:        ec.marketType,
			Mint:        ec.mintPubkey,
			MintLabel:   ec.mintLabel,
			Oracle:      ec.oracle.Pubkey,
			NumOutcomes: ec.numOutcomes,
			RangeMin:    rangeMinF,
			RangeMax:    rangeMaxF,
		})

		typeName := constants.MarketTypeNames[ec.marketType]
		m.result = fmt.Sprintf("Market #%d created (%s) — %s (%s)",
			ec.marketID, typeName, ec.mintLabel, util.FormatPubkey(ec.mintPubkey))

		m.execLog = append(m.execLog, styles.StyleSuccess.Render(fmt.Sprintf(
			"  ✓ Market #%d created (%s)", ec.marketID, typeName)))
		m.execLog = append(m.execLog, styles.StyleDim.Render(fmt.Sprintf(
			"    tx: %s", sig.String())))

		return doneMsg{result: m.result, sig: sig}
	}
}

// ── View ────────────────────────────────────────────────────────────────────

func (m *createMarketScreen) View() string {
	title := styles.StyleTitle.Render("  Create Market\n\n")

	switch m.phase {
	case phaseMarketTypeForm, phaseMarketParamsForm, phaseMarketOracleForm,
		phaseMarketCreatorForm, phaseMarketMintForm, phaseMarketMintInput,
		phaseMarketMintNetSelect, phaseMarketMintMarketSel, phaseMarketFundConfirm:
		return title + m.form.View()

	case phaseMarketMintNetLoad:
		return title + styles.StyleDim.Render("  Fetching token mints from network...")

	case phaseMarketBalanceCheck:
		return title + styles.StyleDim.Render("  Checking creator token balance...")

	case phaseMarketExec:
		s := title
		for _, line := range m.execLog {
			s += line + "\n"
		}
		s += styles.StyleDim.Render("  ...")
		return s

	case phaseMarketDone:
		s := title
		for _, line := range m.execLog {
			s += line + "\n"
		}
		if m.err != nil {
			s += "\n" + styles.StyleDim.Render("  Press Esc to return")
		} else {
			s += "\n" + styles.StyleDim.Render("  Press Esc to return")
		}
		return s
	}
	return ""
}
