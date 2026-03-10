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

	result string
	err    error
}

const (
	phaseMarketTypeForm Phase = iota
	phaseMarketParamsForm
	phaseMarketOracleForm
	phaseMarketCreatorForm
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
				Title("Initial liquidity (USDC)").
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
		m.err = msg.err
		m.phase = phaseMarketDone
		return m, nil

	case doneMsg:
		m.state.AddTxLog("Create Market", msg.sig, true, m.result)
		m.phase = phaseMarketDone
		return m, nil
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
			m.phase = phaseMarketExec
			return m, m.execCreateMarket()
		}
		return m, cmd
	}

	return m, nil
}

func (m *createMarketScreen) advanceToParams() tea.Cmd {
	if m.marketType == "multi" {
		m.form = huh.NewForm(
			huh.NewGroup(
				huh.NewInput().
					Title("Number of outcomes (3-32)").
					Value(&m.numOutcomes).
					Placeholder("4"),
			),
		)
	} else if m.marketType == "continuous" {
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
	} else {
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

func (m *createMarketScreen) execCreateMarket() tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()

		oracle := resolveUserChoice(m.state, m.oracleChoice, true)
		creator := resolveUserChoice(m.state, m.creatorChoice, true)
		if oracle == nil || creator == nil {
			return errMsg{err: fmt.Errorf("invalid user selection")}
		}

		// Parse params
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

		liquidityAmount := util.ParseTokenAmount(m.liquidity)
		deadlineUnix, err := util.ParseDeadline(m.deadline)
		if err != nil {
			return errMsg{err: err}
		}

		var rangeMin, rangeMax int64
		if marketType == constants.MarketTypeContinuous {
			rMin, _ := strconv.ParseFloat(m.rangeMinStr, 64)
			rMax, _ := strconv.ParseFloat(m.rangeMaxStr, 64)
			rangeMin = int64(rMin * float64(constants.SCALE))
			rangeMax = int64(rMax * float64(constants.SCALE))
		}

		// Fetch market count for ID
		pc, err := m.state.FetchProtocolConfig()
		if err != nil {
			return errMsg{err: fmt.Errorf("fetch protocol config: %w", err)}
		}
		marketID := pc.MarketCount

		// Derive PDAs
		marketPda, _ := chain.FindMarket(marketID, m.state.ProgramID)
		vaultAuthority, _ := chain.FindVaultAuthority(marketPda, m.state.ProgramID)
		protocolConfig, _ := chain.FindProtocolConfig(m.state.ProgramID)
		oracleRolePda, _ := chain.FindUserRole(oracle.Pubkey, constants.RoleOracle, m.state.ProgramID)

		// Derive creator role PDA: use Creator role by default.
		// If the user has Admin role but not Creator role, use Admin role PDA instead.
		// For superuser, send program ID as null placeholder (role check is bypassed).
		var creatorRolePda solana.PublicKey
		if creator.Pubkey == m.state.Superuser.Pubkey {
			creatorRolePda = m.state.ProgramID
		} else {
			roleType := constants.RoleCreator
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
			creatorRolePda, _ = chain.FindUserRole(creator.Pubkey, roleType, m.state.ProgramID)
		}
		creatorLpPos, _ := chain.FindLpPosition(marketPda, creator.Pubkey, m.state.ProgramID)

		// Create collateral mint (superuser as authority)
		mintPubkey, _, err := m.state.Client.CreateMint(ctx, m.state.Superuser.Keypair, constants.USDC_DECIMALS)
		if err != nil {
			return errMsg{err: fmt.Errorf("create mint: %w", err)}
		}

		// Create + fund creator ATA
		creatorAta, err := m.state.Client.GetOrCreateATA(ctx, m.state.Superuser.Keypair, creator.Pubkey, mintPubkey)
		if err != nil {
			return errMsg{err: fmt.Errorf("create creator ATA: %w", err)}
		}

		mintAmount := liquidityAmount * 5
		err = m.state.Client.MintTo(ctx, m.state.Superuser.Keypair, mintPubkey, creatorAta, mintAmount)
		if err != nil {
			return errMsg{err: fmt.Errorf("mint to creator: %w", err)}
		}

		// Generate vault keypair
		vaultKp, err := solana.NewRandomPrivateKey()
		if err != nil {
			return errMsg{err: fmt.Errorf("generate vault keypair: %w", err)}
		}

		// Build instruction args
		args := make([]byte, 0)
		args = append(args, chain.EncodeU8(marketType)...)
		args = append(args, chain.EncodeU16LE(uint16(numOutcomes))...)
		args = append(args, chain.EncodeI64LE(deadlineUnix)...)
		args = append(args, chain.EncodePubkey(oracle.Pubkey)...)
		args = append(args, chain.EncodeU64LE(liquidityAmount)...)
		args = append(args, chain.EncodeI64LE(rangeMin)...)
		args = append(args, chain.EncodeI64LE(rangeMax)...)

		accounts := solana.AccountMetaSlice{
			{PublicKey: creator.Pubkey, IsSigner: true, IsWritable: true},
			{PublicKey: creatorRolePda, IsSigner: false, IsWritable: false},
			{PublicKey: protocolConfig, IsSigner: false, IsWritable: true},
			{PublicKey: oracleRolePda, IsSigner: false, IsWritable: false},
			{PublicKey: marketPda, IsSigner: false, IsWritable: true},
			{PublicKey: mintPubkey, IsSigner: false, IsWritable: false},
			{PublicKey: vaultAuthority, IsSigner: false, IsWritable: false},
			{PublicKey: vaultKp.PublicKey(), IsSigner: true, IsWritable: true},
			{PublicKey: creatorAta, IsSigner: false, IsWritable: true},
			{PublicKey: creatorLpPos, IsSigner: false, IsWritable: true},
			{PublicKey: constants.TokenProgramID, IsSigner: false, IsWritable: false},
			{PublicKey: constants.AssociatedTokenProgramID, IsSigner: false, IsWritable: false},
			{PublicKey: constants.SystemProgramID, IsSigner: false, IsWritable: false},
		}

		ix := chain.BuildInstruction(m.state.ProgramID, constants.DiscCreateMarket, args, accounts)
		signers := []solana.PrivateKey{creator.Keypair, vaultKp}
		sig, err := m.state.Client.SendAndConfirm(ctx, []solana.Instruction{ix}, signers, creator.Pubkey)
		if err != nil {
			return errMsg{err: fmt.Errorf("create market: %w", err)}
		}

		// Track market in session
		var rangeMinF, rangeMaxF float64
		if marketType == constants.MarketTypeContinuous {
			rMin, _ := strconv.ParseFloat(m.rangeMinStr, 64)
			rMax, _ := strconv.ParseFloat(m.rangeMaxStr, 64)
			rangeMinF = rMin
			rangeMaxF = rMax
		}

		m.state.Markets = append(m.state.Markets, state.SessionMarket{
			ID:          marketID,
			Label:       m.label,
			Type:        marketType,
			Mint:        mintPubkey,
			Oracle:      oracle.Pubkey,
			NumOutcomes: numOutcomes,
			RangeMin:    rangeMinF,
			RangeMax:    rangeMaxF,
		})

		m.result = fmt.Sprintf("Market #%d created (%s)", marketID, constants.MarketTypeNames[marketType])
		return doneMsg{result: m.result, sig: sig}
	}
}

func (m *createMarketScreen) View() string {
	title := styles.StyleTitle.Render("  Create Market\n\n")

	switch m.phase {
	case phaseMarketTypeForm, phaseMarketParamsForm, phaseMarketOracleForm, phaseMarketCreatorForm:
		return title + m.form.View()
	case phaseMarketExec:
		return title + styles.StyleDim.Render("  Creating market (mint → fund → create)...")
	case phaseMarketDone:
		if m.err != nil {
			return title + styles.StyleError.Render("  ✗ "+m.err.Error()) +
				"\n\n" + styles.StyleDim.Render("  Press Esc to return")
		}
		return title + styles.StyleSuccess.Render("  ✓ "+m.result) +
			"\n\n" + styles.StyleDim.Render("  Press Esc to return")
	}
	return ""
}
