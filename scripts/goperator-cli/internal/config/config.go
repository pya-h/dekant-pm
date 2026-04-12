package config

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"github.com/gagliardetto/solana-go"
	"github.com/joho/godotenv"
)

type Config struct {
	RpcURL      string
	ProgramID   solana.PublicKey
	KeypairPath string
}

func Load() (*Config, error) {
	// Find devkit/.env relative to this binary's location
	// Walk up from scripts/goperator-cli to project root, then devkit/.env
	candidates := []string{
		"../../devkit/.env",
		filepath.Join(projectRoot(), "devkit/.env"),
	}

	for _, p := range candidates {
		if abs, err := filepath.Abs(p); err == nil {
			if _, err := os.Stat(abs); err == nil {
				_ = godotenv.Load(abs)
				break
			}
		}
	}

	rpcURL := os.Getenv("RPC_URL")
	if rpcURL == "" {
		rpcURL = "http://localhost:8899"
	}

	programIDStr := os.Getenv("PROGRAM_ID")
	if programIDStr == "" {
		programIDStr = "Fa2ookSb6meqem6F1oZcVv1PAxQzNtr7zkf1XiDBFgAf"
	}
	programID, err := solana.PublicKeyFromBase58(programIDStr)
	if err != nil {
		return nil, fmt.Errorf("invalid PROGRAM_ID %q: %w", programIDStr, err)
	}

	keypairPath := os.Getenv("KEYPAIR_PATH")
	if keypairPath == "" {
		home, _ := os.UserHomeDir()
		keypairPath = filepath.Join(home, ".config", "solana", "id.json")
	}
	if keypairPath[0] == '~' {
		home, _ := os.UserHomeDir()
		keypairPath = filepath.Join(home, keypairPath[1:])
	}

	return &Config{
		RpcURL:      rpcURL,
		ProgramID:   programID,
		KeypairPath: keypairPath,
	}, nil
}

func projectRoot() string {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		return "."
	}
	// internal/config/config.go -> go up 4 levels to project root
	return filepath.Join(filepath.Dir(filename), "..", "..", "..", "..")
}
