package chain

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
)

type Client struct {
	RPC       *rpc.Client
	ProgramID solana.PublicKey
}

func NewClient(rpcURL string, programID solana.PublicKey) *Client {
	return &Client{
		RPC:       rpc.New(rpcURL),
		ProgramID: programID,
	}
}

// LoadKeypair loads a Solana keypair from a JSON file.
func LoadKeypair(path string) (solana.PrivateKey, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read keypair file: %w", err)
	}

	var raw []byte
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parse keypair JSON: %w", err)
	}

	return solana.PrivateKey(raw), nil
}

// GetAccountInfo fetches raw account data.
func (c *Client) GetAccountInfo(ctx context.Context, addr solana.PublicKey) ([]byte, error) {
	resp, err := c.RPC.GetAccountInfo(ctx, addr)
	if err != nil {
		return nil, fmt.Errorf("rpc: %w", err)
	}
	if resp == nil || resp.Value == nil {
		return nil, fmt.Errorf("account not found: %s", addr)
	}
	return resp.Value.Data.GetBinary(), nil
}

// AccountExists checks whether an on-chain account exists.
// Returns (true, nil) if found, (false, nil) if absent, (false, err) on RPC failure.
func (c *Client) AccountExists(ctx context.Context, addr solana.PublicKey) (bool, error) {
	resp, err := c.RPC.GetAccountInfo(ctx, addr)
	if err != nil {
		return false, err
	}
	return resp != nil && resp.Value != nil, nil
}

// GetBalance returns the SOL balance of a pubkey in lamports.
func (c *Client) GetBalance(ctx context.Context, pubkey solana.PublicKey) (uint64, error) {
	resp, err := c.RPC.GetBalance(ctx, pubkey, rpc.CommitmentConfirmed)
	if err != nil {
		return 0, err
	}
	return resp.Value, nil
}

// GetSOLBalance returns the SOL balance of a pubkey in lamports.
func (c *Client) GetSOLBalance(ctx context.Context, pubkey solana.PublicKey) (uint64, error) {
	return c.GetBalance(ctx, pubkey)
}

// RequestAirdrop airdrops lamports to a pubkey (localnet only).
func (c *Client) RequestAirdrop(ctx context.Context, pubkey solana.PublicKey, lamports uint64) (solana.Signature, error) {
	sig, err := c.RPC.RequestAirdrop(ctx, pubkey, lamports, rpc.CommitmentConfirmed)
	if err != nil {
		return solana.Signature{}, err
	}

	// Wait for confirmation
	err = c.ConfirmTransaction(ctx, sig)
	return sig, err
}

// ConfirmTransaction polls until a transaction is confirmed.
func (c *Client) ConfirmTransaction(ctx context.Context, sig solana.Signature) error {
	timeout := time.After(30 * time.Second)
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-timeout:
			return fmt.Errorf("transaction confirmation timeout: %s", sig)
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			resp, err := c.RPC.GetSignatureStatuses(ctx, false, sig)
			if err != nil {
				continue
			}
			if resp != nil && len(resp.Value) > 0 && resp.Value[0] != nil {
				if resp.Value[0].Err != nil {
					return fmt.Errorf("transaction failed: %v", resp.Value[0].Err)
				}
				if resp.Value[0].ConfirmationStatus == rpc.ConfirmationStatusConfirmed ||
					resp.Value[0].ConfirmationStatus == rpc.ConfirmationStatusFinalized {
					return nil
				}
			}
		}
	}
}

// GetLatestBlockhash returns the latest blockhash.
func (c *Client) GetLatestBlockhash(ctx context.Context) (solana.Hash, error) {
	resp, err := c.RPC.GetLatestBlockhash(ctx, rpc.CommitmentConfirmed)
	if err != nil {
		return solana.Hash{}, err
	}
	return resp.Value.Blockhash, nil
}
