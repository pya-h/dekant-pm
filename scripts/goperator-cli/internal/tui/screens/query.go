package screens

import (
	"context"
	"fmt"
	"strings"

	"goperator-cli/internal/chain"
	"goperator-cli/internal/constants"
	"goperator-cli/internal/state"
	"goperator-cli/internal/tui/styles"
	"goperator-cli/internal/util"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/huh"
	"github.com/gagliardetto/solana-go"
)

// ── Query Market Info ───────────────────────────────────────────────────────

type queryMarketScreen struct {
	state        *state.SessionState
	form         *huh.Form
	phase        Phase
	marketChoice string
	market       *state.SessionMarket
	infoView     string
	err          error
}

const (
	phaseQueryMarketSelect Phase = iota
	phaseQueryMarketLoading
	phaseQueryMarketDone
)

func NewQueryMarketScreen(s *state.SessionState) tea.Model {
	if len(s.Markets) == 0 {
		return &queryMarketScreen{state: s, phase: phaseQueryMarketDone, err: fmt.Errorf("no markets available")}
	}

	m := &queryMarketScreen{state: s}
	marketChoices := buildMarketChoices(s)

	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("Select market to inspect").
				Options(toHuhOptions(marketChoices)...).
				Value(&m.marketChoice),
		),
	)
	return m
}

func (m *queryMarketScreen) Init() tea.Cmd {
	if m.form == nil {
		return nil
	}
	return m.form.Init()
}

func (m *queryMarketScreen) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if msg.String() == "esc" {
			return m, returnToMenu(nil)
		}

	case errMsg:
		m.err = msg.err
		m.phase = phaseQueryMarketDone
		return m, nil

	case dataMsg:
		m.infoView = msg.data.(string)
		m.phase = phaseQueryMarketDone
		return m, nil
	}

	switch m.phase {
	case phaseQueryMarketSelect:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			if m.marketChoice == "Cancel" {
				return m, returnToMenu(nil)
			}
			m.market = resolveMarketChoice(m.state, m.marketChoice)
			m.phase = phaseQueryMarketLoading
			return m, m.loadMarketInfo()
		}
		return m, cmd
	}

	return m, nil
}

func (m *queryMarketScreen) loadMarketInfo() tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		if m.market == nil {
			return errMsg{err: fmt.Errorf("invalid market")}
		}

		md, marketPda, err := m.state.FetchMarket(m.market.ID)
		if err != nil {
			return errMsg{err: err}
		}

		vaultBalance, _ := m.state.Client.GetTokenBalance(ctx, md.Vault)
		probs := util.ComputeProbabilities(md.Reserves, md.TotalMinted)

		var lines []string
		lines = append(lines, styles.StyleTitle.Render(fmt.Sprintf("  Market #%d: %s", m.market.ID, m.market.Label)))
		lines = append(lines, "")

		// Key-value info
		typeName := constants.MarketTypeNames[md.MarketType]
		if typeName == "" {
			typeName = fmt.Sprintf("Unknown(%d)", md.MarketType)
		}
		stateName := constants.MarketStateNames[md.State]
		if stateName == "" {
			stateName = fmt.Sprintf("Unknown(%d)", md.State)
		}

		kv := []string{
			fmt.Sprintf("  %-24s  %s", styles.StyleKey.Render("PDA"), marketPda.String()),
			fmt.Sprintf("  %-24s  %s", styles.StyleKey.Render("Type"), typeName),
			fmt.Sprintf("  %-24s  %s", styles.StyleKey.Render("State"), stateName),
			fmt.Sprintf("  %-24s  %s", styles.StyleKey.Render("Creator"), md.Creator.String()),
			fmt.Sprintf("  %-24s  %s", styles.StyleKey.Render("Oracle"), md.Oracle.String()),
			fmt.Sprintf("  %-24s  %s", styles.StyleKey.Render("Collateral mint"), md.CollateralMint.String()),
			fmt.Sprintf("  %-24s  %s USDC", styles.StyleKey.Render("Vault balance"), util.FormatTokenAmount(vaultBalance)),
			fmt.Sprintf("  %-24s  %s", styles.StyleKey.Render("Deadline"), util.FormatTimestamp(md.Deadline)),
			fmt.Sprintf("  %-24s  %s", styles.StyleKey.Render("Created"), util.FormatTimestamp(md.CreatedAt)),
			fmt.Sprintf("  %-24s  %d", styles.StyleKey.Render("Outcomes/bins"), md.NumOutcomes),
			fmt.Sprintf("  %-24s  %s", styles.StyleKey.Render("Total minted"), md.TotalMinted.String()),
			fmt.Sprintf("  %-24s  %s", styles.StyleKey.Render("LP shares total"), md.LpSharesTotal.String()),
			fmt.Sprintf("  %-24s  %s", styles.StyleKey.Render("LP fee accumulated"), md.LpFeeAccumulated.String()),
			fmt.Sprintf("  %-24s  %s USDC", styles.StyleKey.Render("Protocol fee"), util.FormatTokenAmount(md.ProtocolFeeAccumulated)),
		}
		lines = append(lines, kv...)

		if md.MarketType == constants.MarketTypeContinuous {
			lines = append(lines, fmt.Sprintf("\n  Range: [%.1f, %.1f]",
				chain.ScaleToFloat(md.RangeMin), chain.ScaleToFloat(md.RangeMax)))
		}

		if md.State == constants.MarketStateResolved {
			lines = append(lines, "")
			lines = append(lines, styles.StyleSuccess.Render("  Resolved:"))
			lines = append(lines, fmt.Sprintf("  %-24s  %s", styles.StyleKey.Render("Winner"),
				util.OutcomeLabel(md.MarketType, int(md.ResolvedOutcome))))
			lines = append(lines, fmt.Sprintf("  %-24s  %s", styles.StyleKey.Render("Resolved at"),
				util.FormatTimestamp(md.ResolvedAt)))
			if md.MarketType == constants.MarketTypeContinuous {
				lines = append(lines, fmt.Sprintf("  %-24s  %.2f", styles.StyleKey.Render("Resolved value"),
					chain.ScaleToFloat(md.ResolvedValue)))
			}
		}

		// Probabilities
		lines = append(lines, "")
		lines = append(lines, styles.StyleDim.Render("  Probabilities:"))
		maxShow := len(probs)
		if maxShow > 32 {
			maxShow = 32
		}
		for i := 0; i < maxShow; i++ {
			if len(probs) > 10 && probs[i] < 0.001 {
				continue
			}
			label := util.OutcomeLabel(md.MarketType, i)
			bar := styles.ProbBar(probs[i], 20)
			highlight := ""
			if md.State == constants.MarketStateResolved && i == int(md.ResolvedOutcome) {
				highlight = styles.StyleWarning.Render(" ◄")
			}
			lines = append(lines, fmt.Sprintf("    %-12s %s%s", label, bar, highlight))
		}
		if len(probs) > maxShow {
			lines = append(lines, styles.StyleDim.Render(fmt.Sprintf("    ... (%d more bins)", len(probs)-maxShow)))
		}

		// ASCII chart for continuous markets
		if md.MarketType == constants.MarketTypeContinuous && len(probs) > 2 {
			lines = append(lines, "")
			lines = append(lines, styles.StyleDim.Render("  Distribution chart:"))
			chart := renderSimpleChart(probs, 40, 8)
			lines = append(lines, chart)
		}

		lines = append(lines, "")
		lines = append(lines, styles.StyleDim.Render("  Press Esc to return"))

		return dataMsg{data: strings.Join(lines, "\n")}
	}
}

func (m *queryMarketScreen) View() string {
	switch m.phase {
	case phaseQueryMarketSelect:
		return styles.StyleTitle.Render("  Query Market Info\n\n") + m.form.View()
	case phaseQueryMarketLoading:
		return styles.StyleTitle.Render("  Query Market Info\n\n") +
			styles.StyleDim.Render("  Loading market data...")
	case phaseQueryMarketDone:
		if m.err != nil {
			return styles.StyleTitle.Render("  Query Market Info\n\n") +
				styles.StyleError.Render("  ✗ "+m.err.Error()) +
				"\n\n" + styles.StyleDim.Render("  Press Esc to return")
		}
		return m.infoView
	}
	return ""
}

// ── View Position ───────────────────────────────────────────────────────────

type viewPositionScreen struct {
	state        *state.SessionState
	form         *huh.Form
	phase        Phase
	marketChoice string
	userChoice   string
	market       *state.SessionMarket
	infoView     string
	err          error
}

const (
	phasePositionMarket Phase = iota + 40
	phasePositionUser
	phasePositionLoading
	phasePositionDone
)

func NewViewPositionScreen(s *state.SessionState) tea.Model {
	if len(s.Markets) == 0 {
		return &viewPositionScreen{state: s, phase: phasePositionDone, err: fmt.Errorf("no markets available")}
	}

	m := &viewPositionScreen{state: s}
	marketChoices := buildMarketChoices(s)

	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title("Select market").
				Options(toHuhOptions(marketChoices)...).
				Value(&m.marketChoice),
		),
	)
	m.phase = phasePositionMarket
	return m
}

func (m *viewPositionScreen) Init() tea.Cmd {
	if m.form == nil {
		return nil
	}
	return m.form.Init()
}

func (m *viewPositionScreen) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if msg.String() == "esc" {
			return m, returnToMenu(nil)
		}

	case errMsg:
		m.err = msg.err
		m.phase = phasePositionDone
		return m, nil

	case dataMsg:
		m.infoView = msg.data.(string)
		m.phase = phasePositionDone
		return m, nil
	}

	switch m.phase {
	case phasePositionMarket:
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
						Title("View position for").
						Options(toHuhOptions(userChoices)...).
						Value(&m.userChoice),
				),
			)
			m.phase = phasePositionUser
			return m, m.form.Init()
		}
		return m, cmd

	case phasePositionUser:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			if m.userChoice == "Cancel" {
				return m, returnToMenu(nil)
			}
			m.phase = phasePositionLoading
			return m, m.loadPosition()
		}
		return m, cmd
	}

	return m, nil
}

func (m *viewPositionScreen) loadPosition() tea.Cmd {
	return func() tea.Msg {
		if m.market == nil {
			return errMsg{err: fmt.Errorf("invalid market")}
		}

		user := resolveUserChoice(m.state, m.userChoice, true)
		if user == nil {
			return errMsg{err: fmt.Errorf("invalid user")}
		}

		marketPda, _ := chain.FindMarket(m.market.ID, m.state.ProgramID)
		md, _, err := m.state.FetchMarket(m.market.ID)
		if err != nil {
			return errMsg{err: err}
		}

		pos, _, posErr := m.state.FetchUserPosition(marketPda, user.Pubkey)
		lp, _, lpErr := m.state.FetchLpPosition(marketPda, user.Pubkey)

		if posErr != nil && lpErr != nil {
			return dataMsg{data: styles.StyleWarning.Render("  No position found for this user.") +
				"\n\n" + styles.StyleDim.Render("  Press Esc to return")}
		}

		var lines []string
		lines = append(lines, styles.StyleTitle.Render(fmt.Sprintf("  %s's position in Market #%d", user.Label, m.market.ID)))

		// Trading position
		if posErr == nil {
			lines = append(lines, "")
			lines = append(lines, fmt.Sprintf("  %-20s  %s USDC", styles.StyleKey.Render("Total deposited"), util.FormatTokenAmount(pos.TotalDeposited)))
			lines = append(lines, fmt.Sprintf("  %-20s  %s USDC", styles.StyleKey.Render("Total withdrawn"), util.FormatTokenAmount(pos.TotalWithdrawn)))
			claimed := "No"
			if pos.Claimed {
				claimed = "Yes"
			}
			lines = append(lines, fmt.Sprintf("  %-20s  %s", styles.StyleKey.Render("Claimed"), claimed))

			lines = append(lines, "")
			lines = append(lines, styles.StyleDim.Render("  Holdings:"))
			hasHoldings := false
			for i, h := range pos.Holdings {
				if h > 0 {
					hasHoldings = true
					label := util.OutcomeLabel(md.MarketType, i)
					isWinner := md.State == constants.MarketStateResolved && i == int(md.ResolvedOutcome)
					winnerMark := ""
					if isWinner {
						winnerMark = styles.StyleSuccess.Render(" (winner)")
					}
					lines = append(lines, fmt.Sprintf("    %-12s %s%s", label, util.FormatTokenAmount(h), winnerMark))
				}
			}
			if !hasHoldings {
				lines = append(lines, styles.StyleDim.Render("    (no holdings)"))
			}
		}

		// LP position
		if lpErr == nil {
			lines = append(lines, "")
			lines = append(lines, styles.StyleDim.Render("  LP Position:"))
			lines = append(lines, fmt.Sprintf("    %-20s  %s", styles.StyleKey.Render("Shares"), lp.Shares.String()))
			lines = append(lines, fmt.Sprintf("    %-20s  %s USDC", styles.StyleKey.Render("Deposited"), util.FormatTokenAmount(lp.DepositedCollateral)))
		}

		lines = append(lines, "")
		lines = append(lines, styles.StyleDim.Render("  Press Esc to return"))

		return dataMsg{data: strings.Join(lines, "\n")}
	}
}

func (m *viewPositionScreen) View() string {
	switch m.phase {
	case phasePositionMarket, phasePositionUser:
		return styles.StyleTitle.Render("  View Position\n\n") + m.form.View()
	case phasePositionLoading:
		return styles.StyleTitle.Render("  View Position\n\n") +
			styles.StyleDim.Render("  Loading position...")
	case phasePositionDone:
		if m.err != nil {
			return styles.StyleTitle.Render("  View Position\n\n") +
				styles.StyleError.Render("  ✗ "+m.err.Error()) +
				"\n\n" + styles.StyleDim.Render("  Press Esc to return")
		}
		return m.infoView
	}
	return ""
}

// ── View Balances ────────────────────────────────────────────────────────

type viewBalancesScreen struct {
	state  *state.SessionState
	phase  Phase
	result string
	err    error
}

const (
	phaseBalancesLoad Phase = iota + 50
	phaseBalancesDone
)

func NewViewBalancesScreen(s *state.SessionState) tea.Model {
	if len(s.Users) == 0 {
		return &viewBalancesScreen{state: s, phase: phaseBalancesDone, err: fmt.Errorf("no users available")}
	}
	return &viewBalancesScreen{state: s, phase: phaseBalancesLoad}
}

func (m *viewBalancesScreen) Init() tea.Cmd {
	return m.loadBalances()
}

func (m *viewBalancesScreen) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if msg.String() == "esc" {
			return m, returnToMenu(nil)
		}
	case doneMsg:
		m.result = msg.result
		m.phase = phaseBalancesDone
		return m, nil
	case errMsg:
		m.err = msg.err
		m.phase = phaseBalancesDone
		return m, nil
	}
	return m, nil
}

func (m *viewBalancesScreen) loadBalances() tea.Cmd {
	return func() tea.Msg {
		ctx := context.Background()
		var sb strings.Builder

		// Collect unique mints from markets
		type mintInfo struct {
			Mint  solana.PublicKey
			Label string
		}
		seen := map[string]bool{}
		var mints []mintInfo
		for _, mkt := range m.state.Markets {
			key := mkt.Mint.String()
			if !seen[key] {
				seen[key] = true
				mints = append(mints, mintInfo{Mint: mkt.Mint, Label: fmt.Sprintf("Market #%d", mkt.ID)})
			}
		}

		for _, user := range m.state.Users {
			sb.WriteString(fmt.Sprintf("  %s (%s)\n", user.Label, util.FormatPubkey(user.Pubkey)))
			if len(user.Roles) > 0 {
				sb.WriteString(fmt.Sprintf("    Roles: [%s]\n", strings.Join(user.Roles, ", ")))
			}

			// SOL balance
			solBal, err := m.state.Client.GetSOLBalance(ctx, user.Pubkey)
			if err == nil {
				sb.WriteString(fmt.Sprintf("    SOL: %.4f\n", float64(solBal)/1e9))
			} else {
				sb.WriteString("    SOL: (error)\n")
			}

			// Token balances
			for _, mi := range mints {
				ata, err := m.state.Client.GetOrCreateATA(ctx, m.state.Superuser.Keypair, user.Pubkey, mi.Mint)
				if err != nil {
					sb.WriteString(fmt.Sprintf("    %s: 0 USDC\n", mi.Label))
					continue
				}
				bal, err := m.state.Client.GetTokenBalance(ctx, ata)
				if err != nil {
					sb.WriteString(fmt.Sprintf("    %s: 0 USDC\n", mi.Label))
					continue
				}
				sb.WriteString(fmt.Sprintf("    %s: %s USDC\n", mi.Label, util.FormatTokenAmount(bal)))
			}

			if len(mints) == 0 {
				sb.WriteString("    No markets -- no token balances to show\n")
			}
			sb.WriteString("\n")
		}

		return doneMsg{result: sb.String()}
	}
}

func (m *viewBalancesScreen) View() string {
	title := styles.StyleTitle.Render("  User Balances\n\n")
	switch m.phase {
	case phaseBalancesLoad:
		return title + styles.StyleDim.Render("  Loading balances...")
	case phaseBalancesDone:
		if m.err != nil {
			return title + styles.StyleError.Render("  "+m.err.Error()) +
				"\n\n" + styles.StyleDim.Render("  Press Esc to return")
		}
		return title + m.result + styles.StyleDim.Render("  Press Esc to return")
	}
	return ""
}

// ── Simple ASCII Chart ──────────────────────────────────────────────────────

func renderSimpleChart(data []float64, width, height int) string {
	if len(data) == 0 {
		return ""
	}

	maxVal := 0.0
	for _, v := range data {
		if v > maxVal {
			maxVal = v
		}
	}
	if maxVal == 0 {
		maxVal = 1
	}

	lines := make([]string, height)
	for row := 0; row < height; row++ {
		threshold := maxVal * float64(height-row) / float64(height)
		line := "    "
		for i := 0; i < len(data) && i < width; i++ {
			if data[i]*100 >= threshold*100 {
				line += "█"
			} else {
				line += " "
			}
		}
		lines[row] = line
	}

	return strings.Join(lines, "\n")
}
