package main

import (
	"fmt"
	"os"

	"goperator-cli/internal/config"
	"goperator-cli/internal/state"
	"goperator-cli/internal/tui"

	tea "github.com/charmbracelet/bubbletea"
)

func main() {
	// Load config
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Config error: %v\n", err)
		os.Exit(1)
	}

	// Create session state
	sess, err := state.NewSessionState(cfg.RpcURL, cfg.ProgramID, cfg.KeypairPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Init error: %v\n", err)
		os.Exit(1)
	}

	// Verify protocol
	if err := sess.VerifyProtocol(); err != nil {
		fmt.Fprintf(os.Stderr, "Protocol error: %v\n", err)
		os.Exit(1)
	}

	// Create and run TUI
	app := tui.NewAppModel(sess)
	p := tea.NewProgram(app, tea.WithAltScreen())

	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Runtime error: %v\n", err)
		os.Exit(1)
	}
}
