package screens

import (
	"context"
	"fmt"
	"math"
	"time"

	"goperator-cli/internal/state"
	"goperator-cli/internal/tui/styles"
	"goperator-cli/internal/util"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/huh"
	"github.com/gagliardetto/solana-go"
)

type createTokenScreen struct {
	state    *state.SessionState
	form     *huh.Form
	phase    Phase
	name     string
	decimals string
	supply   string
	mintPk   solana.PublicKey
	result   string
	err      error
}

const (
	phaseTokenName Phase = iota + 100
	phaseTokenDecimals
	phaseTokenSupply
	phaseTokenExec
	phaseTokenDone
)

func NewCreateTokenScreen(s *state.SessionState) tea.Model {
	name := fmt.Sprintf("Token-%x", time.Now().UnixNano()&0xFFFF)

	m := &createTokenScreen{
		state:    s,
		name:     name,
		decimals: "6",
		supply:   "1000000",
	}

	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewInput().
				Title("Token name (for display)").
				Value(&m.name).
				Placeholder(name),
		),
	)
	m.phase = phaseTokenName
	return m
}

func (m *createTokenScreen) Init() tea.Cmd {
	return m.form.Init()
}

func (m *createTokenScreen) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if msg.String() == "esc" {
			return m, returnToMenu(nil)
		}

	case errMsg:
		m.err = msg.err
		m.state.LogError("Create Token", msg.err)
		m.phase = phaseTokenDone
		return m, nil

	case doneMsg:
		m.result = msg.result
		m.phase = phaseTokenDone
		return m, nil
	}

	switch m.phase {
	case phaseTokenName:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			if m.name == "" {
				m.name = "Token"
			}
			return m, m.advanceToDecimals()
		}
		return m, cmd

	case phaseTokenDecimals:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			return m, m.advanceToSupply()
		}
		return m, cmd

	case phaseTokenSupply:
		form, cmd := m.form.Update(msg)
		if f, ok := form.(*huh.Form); ok {
			m.form = f
		}
		if m.form.State == huh.StateCompleted {
			m.phase = phaseTokenExec
			return m, m.execCreateToken()
		}
		return m, cmd
	}

	return m, nil
}

func (m *createTokenScreen) advanceToDecimals() tea.Cmd {
	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewInput().
				Title("Decimals (0-18)").
				Value(&m.decimals).
				Placeholder("6"),
		),
	)
	m.phase = phaseTokenDecimals
	return m.form.Init()
}

func (m *createTokenScreen) advanceToSupply() tea.Cmd {
	m.form = huh.NewForm(
		huh.NewGroup(
			huh.NewInput().
				Title("Initial supply to mint to superuser").
				Value(&m.supply).
				Placeholder("1000000"),
		),
	)
	m.phase = phaseTokenSupply
	return m.form.Init()
}

func (m *createTokenScreen) execCreateToken() tea.Cmd {
	return func() tea.Msg {
		// Parse decimals
		var dec int
		if _, err := fmt.Sscanf(m.decimals, "%d", &dec); err != nil || dec < 0 || dec > 18 {
			return errMsg{err: fmt.Errorf("invalid decimals: %s", m.decimals)}
		}

		ctx := context.Background()

		// Create the mint
		mintPk, _, err := m.state.Client.CreateMint(ctx, m.state.Superuser.Keypair, uint8(dec))
		if err != nil {
			return errMsg{err: fmt.Errorf("create mint: %w", err)}
		}
		m.mintPk = mintPk

		// Parse supply
		supplyFloat := 0.0
		if _, err := fmt.Sscanf(m.supply, "%f", &supplyFloat); err != nil || supplyFloat <= 0 {
			return errMsg{err: fmt.Errorf("invalid supply: %s", m.supply)}
		}
		rawFloat := supplyFloat * math.Pow10(dec)
		if rawFloat > float64(math.MaxUint64) || rawFloat < 0 {
			return errMsg{err: fmt.Errorf("supply too large for %d decimals (max: %.0f)", dec, float64(math.MaxUint64)/math.Pow10(dec))}
		}
		rawAmount := uint64(rawFloat)

		// Create ATA for superuser
		ata, err := m.state.Client.GetOrCreateATA(ctx, m.state.Superuser.Keypair, m.state.Superuser.Pubkey, mintPk)
		if err != nil {
			return errMsg{err: fmt.Errorf("create ATA: %w", err)}
		}

		// Mint tokens to superuser
		err = m.state.Client.MintTo(ctx, m.state.Superuser.Keypair, mintPk, ata, rawAmount)
		if err != nil {
			return errMsg{err: fmt.Errorf("mint tokens: %w", err)}
		}

		// Get balance
		balance, balErr := m.state.Client.GetTokenBalance(ctx, ata)
		balStr := formatAmountWithDecimals(balance, dec)
		if balErr != nil {
			balStr = "(balance check failed)"
		}

		return doneMsg{
			result: fmt.Sprintf("Created SPL token \"%s\"\n  Mint: %s\n  Decimals: %d\n  Minted to Superuser: %s\n  Balance: %s",
				m.name, mintPk.String(), dec,
				formatAmountWithDecimals(rawAmount, dec),
				balStr),
		}
	}
}

// formatAmountWithDecimals formats a raw token amount with given decimals.
func formatAmountWithDecimals(amount uint64, decimals int) string {
	if decimals == 0 {
		return fmt.Sprintf("%d", amount)
	}
	divisor := uint64(math.Pow10(decimals))
	whole := amount / divisor
	frac := amount % divisor
	fracStr := fmt.Sprintf("%0*d", decimals, frac)
	// Trim trailing zeros
	trimmed := fracStr
	for len(trimmed) > 0 && trimmed[len(trimmed)-1] == '0' {
		trimmed = trimmed[:len(trimmed)-1]
	}
	if trimmed == "" {
		return fmt.Sprintf("%d", whole)
	}
	return fmt.Sprintf("%d.%s", whole, trimmed)
}

func (m *createTokenScreen) View() string {
	title := styles.StyleTitle.Render("  Create SPL Token\n\n")
	info := styles.StyleDim.Render(fmt.Sprintf("  Superuser (mint authority): %s\n\n", util.FormatPubkey(m.state.Superuser.Pubkey)))

	switch m.phase {
	case phaseTokenName, phaseTokenDecimals, phaseTokenSupply:
		return title + info + m.form.View()
	case phaseTokenExec:
		return title + info + styles.StyleDim.Render("  Creating token...")
	case phaseTokenDone:
		if m.err != nil {
			return title + info +
				styles.StyleError.Render("  "+m.err.Error()) +
				"\n\n" + styles.StyleDim.Render("  Press Esc to return")
		}
		return title + info +
			styles.StyleSuccess.Render("  "+m.result) +
			"\n\n" + styles.StyleDim.Render("  Press Esc to return")
	}
	return ""
}
