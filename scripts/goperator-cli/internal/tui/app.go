package tui

import (
	"fmt"
	"io"
	"strings"

	"goperator-cli/internal/state"
	"goperator-cli/internal/tui/styles"
	"goperator-cli/internal/tui/types"

	"github.com/charmbracelet/bubbles/list"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// Screen represents the current screen.
type Screen int

const (
	ScreenMenu Screen = iota
	ScreenAction
	ScreenTxLog
)

// MenuItem represents a main menu item.
type MenuItem struct {
	Title       string
	Description string
	Action      string
}

func (m MenuItem) FilterValue() string { return m.Title }

// MenuItemDelegate handles rendering menu items.
type MenuItemDelegate struct{}

func (d MenuItemDelegate) Height() int                             { return 1 }
func (d MenuItemDelegate) Spacing() int                            { return 0 }
func (d MenuItemDelegate) Update(_ tea.Msg, _ *list.Model) tea.Cmd { return nil }
func (d MenuItemDelegate) Render(w io.Writer, m list.Model, index int, item list.Item) {
	mi, ok := item.(MenuItem)
	if !ok {
		return
	}

	cursor := "  "
	style := styles.StyleMenuItem
	if index == m.Index() {
		cursor = styles.StyleSelected.Render("▸ ")
		style = styles.StyleSelected
	}

	// Section headers (action starts with "---")
	if strings.HasPrefix(mi.Action, "---") {
		fmt.Fprint(w, "\n")
		fmt.Fprint(w, styles.StyleSectionHeader.Render(mi.Title))
		return
	}

	// Number shortcut
	shortcut := styles.StyleDim.Render(fmt.Sprintf("%d ", (index)%10))
	fmt.Fprint(w, cursor+shortcut+style.Render(mi.Title))
}

// ActionMsg is sent when a menu action is selected.
type ActionMsg struct {
	Action string
}

// AppModel is the root Bubble Tea model.
type AppModel struct {
	state        *state.SessionState
	menu         list.Model
	screen       Screen
	activeAction tea.Model
	showTxLog    bool
	width        int
	height       int
	quitting     bool
	statusMsg    string
}

// NewAppModel creates the root app model.
func NewAppModel(s *state.SessionState) AppModel {
	items := buildMenuItems()

	delegate := MenuItemDelegate{}
	l := list.New(items, delegate, 50, 20)
	l.Title = ""
	l.SetShowTitle(false)
	l.SetShowStatusBar(false)
	l.SetShowHelp(false)
	l.SetFilteringEnabled(false)
	l.SetShowPagination(false)
	l.InfiniteScrolling = true

	return AppModel{
		state:  s,
		menu:   l,
		screen: ScreenMenu,
	}
}

func buildMenuItems() []list.Item {
	return []list.Item{
		MenuItem{Title: "── User Management ──", Action: "---user"},
		MenuItem{Title: "Add New User", Action: "add-user", Description: "Generate keypair + airdrop SOL"},
		MenuItem{Title: "Assign Role", Action: "assign-role", Description: "Oracle / Creator / Admin"},
		MenuItem{Title: "Fund User", Action: "fund-user", Description: "Mint USDC to user"},
		MenuItem{Title: "── Market Operations ──", Action: "---market"},
		MenuItem{Title: "Create Market", Action: "create-market", Description: "Binary / Multi / Continuous"},
		MenuItem{Title: "Pause / Unpause", Action: "pause-unpause", Description: "Toggle market state"},
		MenuItem{Title: "── Trading ──", Action: "---trading"},
		MenuItem{Title: "Buy Outcome", Action: "buy", Description: "Fixed / To-Price / Distribution"},
		MenuItem{Title: "Sell Outcome", Action: "sell", Description: "Fixed / To-Price / Distribution"},
		MenuItem{Title: "── Liquidity ──", Action: "---liquidity"},
		MenuItem{Title: "Add Liquidity", Action: "add-lp", Description: "Deposit collateral"},
		MenuItem{Title: "Remove Liquidity", Action: "remove-lp", Description: "Burn LP shares"},
		MenuItem{Title: "── Settlement ──", Action: "---settle"},
		MenuItem{Title: "Resolve Market", Action: "resolve", Description: "Set winning outcome"},
		MenuItem{Title: "Claim Payout", Action: "claim", Description: "Withdraw winnings"},
		MenuItem{Title: "Collect Fees", Action: "collect-fees", Description: "Transfer to treasury"},
		MenuItem{Title: "── Query ──", Action: "---query"},
		MenuItem{Title: "View Position", Action: "view-position", Description: "User holdings"},
		MenuItem{Title: "Query Market Info", Action: "query-market", Description: "Full market details"},
		MenuItem{Title: "── ──", Action: "---exit"},
		MenuItem{Title: "Exit", Action: "exit", Description: "Quit the CLI"},
	}
}

func (m AppModel) Init() tea.Cmd {
	return nil
}

func (m AppModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.menu.SetSize(msg.Width-4, msg.Height-8)
		return m, nil

	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c", "q":
			if m.screen == ScreenMenu {
				m.quitting = true
				return m, tea.Quit
			}
			// Return to menu from action screen
			m.screen = ScreenMenu
			m.activeAction = nil
			return m, nil

		case "ctrl+r":
			m.state.RandomMode = !m.state.RandomMode
			return m, nil

		case "ctrl+l":
			m.showTxLog = !m.showTxLog
			return m, nil

		case "esc":
			if m.showTxLog {
				m.showTxLog = false
				return m, nil
			}
			if m.screen != ScreenMenu {
				m.screen = ScreenMenu
				m.activeAction = nil
				return m, nil
			}

		case "enter":
			if m.screen == ScreenMenu {
				return m.handleMenuSelect()
			}
		}

	case types.ActionDoneMsg:
		m.screen = ScreenMenu
		m.activeAction = nil
		if msg.Err != nil {
			m.statusMsg = msg.Err.Error()
		}
		return m, nil
	}

	// Forward to active screen
	if m.screen == ScreenAction && m.activeAction != nil {
		var cmd tea.Cmd
		m.activeAction, cmd = m.activeAction.Update(msg)
		return m, cmd
	}

	// Forward to menu
	if m.screen == ScreenMenu {
		var cmd tea.Cmd
		m.menu, cmd = m.menu.Update(msg)
		return m, cmd
	}

	return m, nil
}

func (m AppModel) handleMenuSelect() (tea.Model, tea.Cmd) {
	selected, ok := m.menu.SelectedItem().(MenuItem)
	if !ok {
		return m, nil
	}

	// Skip section headers
	if strings.HasPrefix(selected.Action, "---") {
		return m, nil
	}

	if selected.Action == "exit" {
		m.quitting = true
		return m, tea.Quit
	}

	// Create the action screen
	actionScreen := CreateActionScreen(selected.Action, m.state)
	if actionScreen == nil {
		return m, nil
	}

	m.screen = ScreenAction
	m.activeAction = actionScreen
	return m, actionScreen.Init()
}

func (m AppModel) View() string {
	if m.quitting {
		return styles.StyleDim.Render("\n  Goodbye!\n")
	}

	var content string

	// Banner
	banner := renderBanner(m.state)

	if m.showTxLog {
		// Show tx log overlay
		content = renderTxLogView(m.state, m.width, m.height-5)
	} else if m.screen == ScreenAction && m.activeAction != nil {
		content = m.activeAction.View()
	} else {
		content = m.menu.View()
	}

	// Status bar
	statusBar := renderStatusBar(m.state, m.width)

	return banner + "\n" + content + "\n" + statusBar
}

func renderBanner(s *state.SessionState) string {
	superkey := s.Superuser.Pubkey.String()
	if len(superkey) > 16 {
		superkey = superkey[:16] + "..."
	}
	title := styles.StyleBanner.Render(
		"DekantPM Goperator CLI" +
			styles.StyleDim.Render(fmt.Sprintf("  %s  U:%d  M:%d",
				superkey, len(s.Users), len(s.Markets))))
	return title
}

func renderStatusBar(s *state.SessionState, width int) string {
	parts := []string{
		styles.StyleDim.Render("localhost"),
	}

	if s.RandomMode {
		parts = append(parts, styles.StyleAccent.Render("Random:ON"))
	} else {
		parts = append(parts, styles.StyleDim.Render("Random:OFF"))
	}

	parts = append(parts,
		styles.StyleDim.Render(fmt.Sprintf("U:%d M:%d TX:%d",
			len(s.Users), len(s.Markets), len(s.TxLog))),
		styles.StyleDim.Render("^R:Random ^L:Log Esc:Menu"),
	)

	content := " " + strings.Join(parts, " │ ") + " "

	return lipgloss.NewStyle().
		Background(lipgloss.Color("#374151")).
		Foreground(lipgloss.Color("#E5E7EB")).
		Width(width).
		Render(content)
}

func renderTxLogView(s *state.SessionState, width, height int) string {
	if len(s.TxLog) == 0 {
		return styles.StyleDim.Render("\n  No transactions yet. Press Ctrl+L to close.")
	}

	lines := []string{
		styles.StyleTitle.Render("  Transaction Log") + styles.StyleDim.Render("  (Ctrl+L to close)"),
		"",
	}

	start := 0
	maxLines := height - 4
	if maxLines < 1 {
		maxLines = 10
	}
	if len(s.TxLog) > maxLines {
		start = len(s.TxLog) - maxLines
	}

	for i := start; i < len(s.TxLog); i++ {
		e := s.TxLog[i]
		timeStr := e.Time.Format("15:04:05")
		icon := styles.StyleSuccess.Render("✓")
		if !e.Success {
			icon = styles.StyleError.Render("✗")
		}
		sig := e.Sig
		if len(sig) > 20 {
			sig = sig[:20] + "..."
		}
		line := fmt.Sprintf("  %s %s %-22s %s",
			styles.StyleDim.Render(timeStr), icon, e.Action, styles.StyleDim.Render(sig))
		if e.Detail != "" {
			line += "  " + styles.StyleDim.Render(e.Detail)
		}
		lines = append(lines, line)
	}

	return strings.Join(lines, "\n")
}
