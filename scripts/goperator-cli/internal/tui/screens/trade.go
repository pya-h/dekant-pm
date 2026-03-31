package screens

import (
	"context"
	"fmt"
	"math"
	"math/big"
	"strconv"
	"strings"

	"goperator-cli/internal/amm"
	"goperator-cli/internal/chain"
	"goperator-cli/internal/constants"
	"goperator-cli/internal/state"
	"goperator-cli/internal/tui/styles"
	"goperator-cli/internal/util"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/huh"
	"github.com/gagliardetto/solana-go"
)

type tradeScreen struct {
	state  *state.SessionState
	isBuy  bool
	form   *huh.Form
	phase  Phase

	marketChoice string
	tradeType    string // "fixed", "toPrice", "distribution"
	outcomeStr   string
	amount       string
	targetProb   string
	limitAmount  string
	mu           string
	sigma        string
	userChoice   string

	market     *state.SessionMarket
	marketData *state.MarketAccount
	result     string
	err        error
}

const (
	phaseTradeMarket Phase = iota
	phaseTradeParams
	phaseTradeToPriceParams
	phaseTradeUser
	phaseTradeExec
	phaseTradeDone
)

func NewTradeScreen(s *state.SessionState, isBuy bool) tea.Model {
	if len(s.Markets) == 0 {
		return &tradeScreen{state: s, isBuy: isBuy, phase: phaseTradeDone, err: fmt.Errorf("no markets available")}
	}

	m := &tradeScreen{state: s, isBuy: isBuy, amount: "10", limitAmount: "1000", targetProb: "70"}
	if s.RandomMode {
		m.amount = s.Rand.TradeAmount()
	}
	marketChoices := buildMarketChoices(s)

	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title(m.actionLabel()+" — Select market").
				Options(toHuhOptions(marketChoices)...).
				Value(&m.marketChoice),
		),
	)
	return m
}

func (m *tradeScreen) actionLabel() string {
	if m.isBuy {
		return "Buy"
	}
	return "Sell"
}

func (m *tradeScreen) Init() tea.Cmd {
	if m.form == nil {
		return nil
	}
	return m.form.Init()
}

func (m *tradeScreen) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if msg.String() == "esc" {
			return m, returnToMenu(nil)
		}

	case errMsg:
		m.err = msg.err
		m.state.LogError("Trade", msg.err)
		m.phase = phaseTradeDone
		return m, nil

	case doneMsg:
		m.state.AddTxLog(m.actionLabel(), msg.sig, true, m.result)
		m.phase = phaseTradeDone
		return m, nil

	case dataMsg:
		md := msg.data.(*state.MarketAccount)
		m.marketData = md
		return m, m.buildParamsForm()
	}

	switch m.phase {
	case phaseTradeMarket:
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
			return m, m.loadMarketData()
		}
		return m, cmd

	case phaseTradeParams:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			return m, m.advanceToUser()
		}
		return m, cmd

	case phaseTradeToPriceParams:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			return m, m.showUserSelection()
		}
		return m, cmd

	case phaseTradeUser:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			if m.userChoice == "Cancel" {
				return m, returnToMenu(nil)
			}
			m.phase = phaseTradeExec
			return m, m.execTrade()
		}
		return m, cmd
	}

	return m, nil
}

func (m *tradeScreen) loadMarketData() tea.Cmd {
	return func() tea.Msg {
		md, _, err := m.state.FetchMarket(m.market.ID)
		if err != nil {
			return errMsg{err: err}
		}
		return dataMsg{data: md}
	}
}

func (m *tradeScreen) buildParamsForm() tea.Cmd {
	if m.market.Type == constants.MarketTypeContinuous {
		// Distribution trade
		m.tradeType = "distribution"
		if m.state.RandomMode {
			m.mu = m.state.Rand.Mu(m.market.RangeMin, m.market.RangeMax)
			m.sigma = m.state.Rand.Sigma(m.market.RangeMin, m.market.RangeMax)
		}
		rangeStr := ""
		if m.market.RangeMin != 0 || m.market.RangeMax != 0 {
			rangeStr = fmt.Sprintf(" (range: %.0f–%.0f)", m.market.RangeMin, m.market.RangeMax)
		}
		amountLabel := "Amount (tokens) to buy"
		if !m.isBuy {
			amountLabel = "Token amount to sell"
		}

		m.form = huh.NewForm(
			huh.NewGroup(
				huh.NewInput().
					Title("Mu (center value" + rangeStr + ")").
					Value(&m.mu),
				huh.NewInput().
					Title("Sigma (spread/std-dev)").
					Value(&m.sigma),
				huh.NewInput().
					Title(amountLabel).
					Value(&m.amount).
					Placeholder("10"),
			),
		)
	} else {
		// Discrete trade — choose type and outcome
		if m.state.RandomMode {
			m.outcomeStr = m.state.Rand.Outcome(m.market.NumOutcomes)
			probs := util.ComputeProbabilities(m.marketData.Reserves, m.marketData.TotalMinted)
			outcomeIdx, _ := strconv.Atoi(m.outcomeStr)
			if outcomeIdx < len(probs) {
				m.targetProb = m.state.Rand.TargetProbability(probs[outcomeIdx])
			}
		}
		actionLabel := m.actionLabel()
		outcomeOpts := make([]huh.Option[string], m.market.NumOutcomes)
		for i := 0; i < m.market.NumOutcomes; i++ {
			label := util.OutcomeLabel(m.market.Type, i)
			outcomeOpts[i] = huh.NewOption(label, strconv.Itoa(i))
		}

		inverseLabel := "by shares"
		if !m.isBuy {
			inverseLabel = "by collateral"
		}
		amountLabel := "Amount (tokens) to buy"
		if !m.isBuy {
			amountLabel = "Token amount to sell"
		}

		m.form = huh.NewForm(
			huh.NewGroup(
				huh.NewSelect[string]().
					Title("Trade type").
					Options(
						huh.NewOption(actionLabel+" (fixed amount)", "fixed"),
						huh.NewOption(actionLabel+" ("+inverseLabel+")", "inverse"),
						huh.NewOption(actionLabel+" to Price (target probability)", "toPrice"),
					).
					Value(&m.tradeType),
				huh.NewSelect[string]().
					Title("Select outcome").
					Options(outcomeOpts...).
					Value(&m.outcomeStr),
				huh.NewInput().
					Title(amountLabel).
					Value(&m.amount).
					Placeholder("10"),
			),
		)
	}

	m.phase = phaseTradeParams
	return m.form.Init()
}

func (m *tradeScreen) advanceToUser() tea.Cmd {
	// If inverse, ask for the target amount with the correct label
	if m.tradeType == "inverse" {
		var label string
		if m.isBuy {
			label = "Number of shares to buy"
		} else {
			label = "Collateral to receive"
		}
		m.form = huh.NewForm(
			huh.NewGroup(
				huh.NewInput().
					Title(label).
					Value(&m.amount).
					Placeholder("10"),
			),
		)
		m.phase = phaseTradeToPriceParams // reuse the same phase
		return m.form.Init()
	}

	// If toPrice, ask for target prob and limit first
	if m.tradeType == "toPrice" {
		limitLabel := "Max collateral"
		if !m.isBuy {
			limitLabel = "Min collateral out"
		}
		m.form = huh.NewForm(
			huh.NewGroup(
				huh.NewInput().
					Title("Target probability (%)").
					Value(&m.targetProb).
					Placeholder("70"),
				huh.NewInput().
					Title(limitLabel).
					Value(&m.limitAmount).
					Placeholder("1000"),
			),
		)
		m.phase = phaseTradeToPriceParams
		return m.form.Init()
	}

	return m.showUserSelection()
}

func (m *tradeScreen) showUserSelection() tea.Cmd {
	userChoices := buildUserChoices(m.state, true, true)
	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title(m.actionLabel() + " as").
				Options(toHuhOptions(userChoices)...).
				Value(&m.userChoice),
		),
	)
	m.phase = phaseTradeUser
	return m.form.Init()
}

func (m *tradeScreen) execTrade() tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		user := resolveUserChoice(m.state, m.userChoice, true)
		if user == nil {
			return errMsg{err: fmt.Errorf("invalid user")}
		}

		marketPda, _ := chain.FindMarket(m.market.ID, m.state.ProgramID)
		protocolConfig, _ := chain.FindProtocolConfig(m.state.ProgramID)
		vaultAuthority, _ := chain.FindVaultAuthority(marketPda, m.state.ProgramID)
		userPosition, _ := chain.FindUserPosition(marketPda, user.Pubkey, m.state.ProgramID)

		// Get or create trader ATA
		traderAta, err := m.state.Client.GetOrCreateATA(ctx, m.state.Superuser.Keypair, user.Pubkey, m.marketData.CollateralMint)
		if err != nil {
			return errMsg{err: fmt.Errorf("create ATA: %w", err)}
		}

		// Get balance before
		balanceBefore, _ := m.state.Client.GetTokenBalance(ctx, traderAta)

		var disc [8]byte
		var args []byte
		var preIxs []solana.Instruction
		needsSystemProgram := m.isBuy

		switch m.tradeType {
		case "inverse":
			outcome, _ := strconv.Atoi(m.outcomeStr)
			// Fetch protocol config for fee BPS
			pc, pcErr := m.state.FetchProtocolConfig()
			if pcErr != nil {
				return errMsg{err: fmt.Errorf("fetch protocol config: %w", pcErr)}
			}
			// Convert reserves to []*big.Int for AMM simulation
			bigReserves := make([]*big.Int, len(m.marketData.Reserves))
			for i, r := range m.marketData.Reserves {
				bigReserves[i] = new(big.Int).SetUint64(r)
			}
			if m.isBuy {
				// User wants to buy a target number of shares
				targetShares := new(big.Int).SetUint64(util.ParseTokenAmount(m.amount))
				grossCollateral := amm.FindCollateralForShares(
					bigReserves, m.marketData.TotalMinted, outcome, targetShares, pc.TradeFeeBps,
				)
				disc = constants.DiscBuy
				args = append(chain.EncodeU16LE(uint16(outcome)), chain.EncodeU64LE(grossCollateral.Uint64())...)
			} else {
				// User wants to receive a target collateral amount
				targetCollateral := new(big.Int).SetUint64(util.ParseTokenAmount(m.amount))
				tokensToSell, invErr := amm.FindTokensForCollateral(
					bigReserves, m.marketData.TotalMinted, outcome, targetCollateral, pc.TradeFeeBps,
				)
				if invErr != nil {
					return errMsg{err: invErr}
				}
				disc = constants.DiscSell
				args = append(chain.EncodeU16LE(uint16(outcome)), chain.EncodeU64LE(tokensToSell.Uint64())...)
				needsSystemProgram = false
			}

		case "fixed":
			outcome, _ := strconv.Atoi(m.outcomeStr)
			amount := util.ParseTokenAmount(m.amount)
			if m.isBuy {
				disc = constants.DiscBuy
				args = append(chain.EncodeU16LE(uint16(outcome)), chain.EncodeU64LE(amount)...)
			} else {
				disc = constants.DiscSell
				args = append(chain.EncodeU16LE(uint16(outcome)), chain.EncodeU64LE(amount)...)
				needsSystemProgram = false
			}

		case "toPrice":
			outcome, _ := strconv.Atoi(m.outcomeStr)
			probPct, _ := strconv.ParseFloat(m.targetProb, 64)
			targetProb := uint64(math.Floor(probPct * float64(constants.SCALE) / 100))
			limitAmt := util.ParseTokenAmount(m.limitAmount)

			if m.isBuy {
				disc = constants.DiscBuyToPrice
				args = append(args, chain.EncodeU16LE(uint16(outcome))...)
				args = append(args, chain.EncodeU64LE(targetProb)...)
				args = append(args, chain.EncodeU64LE(limitAmt)...)
			} else {
				disc = constants.DiscSellToPrice
				args = append(args, chain.EncodeU16LE(uint16(outcome))...)
				args = append(args, chain.EncodeU64LE(targetProb)...)
				args = append(args, chain.EncodeU64LE(limitAmt)...)
				needsSystemProgram = false
			}

		case "distribution":
			muF, _ := strconv.ParseFloat(m.mu, 64)
			sigmaF, _ := strconv.ParseFloat(m.sigma, 64)
			muScaled := int64(muF * float64(constants.SCALE))
			sigmaScaled := uint64(sigmaF * float64(constants.SCALE))
			amount := util.ParseTokenAmount(m.amount)

			preIxs = append(preIxs, chain.ComputeBudgetInstruction(1_000_000))

			if m.isBuy {
				disc = constants.DiscBuyDistribution
				args = append(args, chain.EncodeI64LE(muScaled)...)
				args = append(args, chain.EncodeU64LE(sigmaScaled)...)
				args = append(args, chain.EncodeU64LE(amount)...)
			} else {
				disc = constants.DiscSellDistribution
				args = append(args, chain.EncodeI64LE(muScaled)...)
				args = append(args, chain.EncodeU64LE(sigmaScaled)...)
				args = append(args, chain.EncodeU64LE(amount)...)
				needsSystemProgram = false
			}
		}

		accounts := solana.AccountMetaSlice{
			{PublicKey: user.Pubkey, IsSigner: true, IsWritable: true},
			{PublicKey: marketPda, IsSigner: false, IsWritable: true},
			{PublicKey: protocolConfig, IsSigner: false, IsWritable: true},
			{PublicKey: userPosition, IsSigner: false, IsWritable: true},
			{PublicKey: vaultAuthority, IsSigner: false, IsWritable: false},
			{PublicKey: m.marketData.Vault, IsSigner: false, IsWritable: true},
			{PublicKey: traderAta, IsSigner: false, IsWritable: true},
			{PublicKey: constants.TokenProgramID, IsSigner: false, IsWritable: false},
		}
		if needsSystemProgram {
			accounts = append(accounts, &solana.AccountMeta{PublicKey: constants.SystemProgramID, IsSigner: false, IsWritable: false})
		}

		ix := chain.BuildInstruction(m.state.ProgramID, disc, args, accounts)
		instructions := make([]solana.Instruction, 0, len(preIxs)+1)
		instructions = append(instructions, preIxs...)
		instructions = append(instructions, ix)

		sig, err := m.state.Client.SendAndConfirm(ctx, instructions, []solana.PrivateKey{user.Keypair}, user.Pubkey)
		if err != nil {
			return errMsg{err: err}
		}

		// Balance after
		balanceAfter, _ := m.state.Client.GetTokenBalance(ctx, traderAta)

		var diff uint64
		var diffLabel string
		if m.isBuy {
			diff = balanceBefore - balanceAfter
			diffLabel = "Spent"
		} else {
			diff = balanceAfter - balanceBefore
			diffLabel = "Received"
		}

		m.result = fmt.Sprintf("%s %s tokens (balance: %s → %s)",
			diffLabel, util.FormatTokenAmount(diff),
			util.FormatTokenAmount(balanceBefore), util.FormatTokenAmount(balanceAfter))

		return doneMsg{result: m.result, sig: sig}
	}
}

func (m *tradeScreen) View() string {
	title := styles.StyleTitle.Render("  "+m.actionLabel()+" Outcome\n\n")

	// Show probabilities if we have market data
	probView := ""
	if m.marketData != nil {
		probs := util.ComputeProbabilities(m.marketData.Reserves, m.marketData.TotalMinted)
		maxShow := len(probs)
		if maxShow > 10 {
			maxShow = 10
		}
		lines := []string{styles.StyleDim.Render("  Current probabilities:")}
		for i := 0; i < maxShow; i++ {
			label := util.OutcomeLabel(m.market.Type, i)
			bar := styles.ProbBar(probs[i], 20)
			lines = append(lines, fmt.Sprintf("    %-12s %s", label, bar))
		}
		if len(probs) > maxShow {
			lines = append(lines, styles.StyleDim.Render(fmt.Sprintf("    ... (%d more)", len(probs)-maxShow)))
		}
		probView = strings.Join(lines, "\n") + "\n\n"
	}

	switch m.phase {
	case phaseTradeMarket, phaseTradeParams, phaseTradeToPriceParams, phaseTradeUser:
		return title + probView + m.form.View()
	case phaseTradeExec:
		return title + probView + styles.StyleDim.Render("  Executing trade...")
	case phaseTradeDone:
		if m.err != nil {
			return title + styles.StyleError.Render("  ✗ "+m.err.Error()) +
				"\n\n" + styles.StyleDim.Render("  Press Esc to return")
		}
		return title + styles.StyleSuccess.Render("  ✓ "+m.result) +
			"\n\n" + styles.StyleDim.Render("  Press Esc to return")
	}
	return ""
}
