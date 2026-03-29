package chain

import (
	"context"
	"encoding/binary"
	"fmt"

	"goperator-cli/internal/constants"

	"github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/programs/system"
	"github.com/gagliardetto/solana-go/programs/token"
	"github.com/gagliardetto/solana-go/rpc"
)

// DeriveATA derives the associated token account address for owner+mint.
func DeriveATA(owner, mint solana.PublicKey) solana.PublicKey {
	addr, _, _ := solana.FindProgramAddress(
		[][]byte{
			owner.Bytes(),
			constants.TokenProgramID.Bytes(),
			mint.Bytes(),
		},
		constants.AssociatedTokenProgramID,
	)
	return addr
}

// GetTokenBalance returns the token balance of an ATA.
func (c *Client) GetTokenBalance(ctx context.Context, ata solana.PublicKey) (uint64, error) {
	data, err := c.GetAccountInfo(ctx, ata)
	if err != nil {
		return 0, err
	}
	if len(data) < 72 {
		return 0, fmt.Errorf("invalid token account data")
	}
	// Token account layout: mint (32) + owner (32) + amount (8)
	return binary.LittleEndian.Uint64(data[64:72]), nil
}

// CreateMint creates a new SPL token mint.
func (c *Client) CreateMint(ctx context.Context, payer solana.PrivateKey, decimals uint8) (solana.PublicKey, solana.PrivateKey, error) {
	mintKp, err := solana.NewRandomPrivateKey()
	if err != nil {
		return solana.PublicKey{}, nil, err
	}

	lamports, err := c.RPC.GetMinimumBalanceForRentExemption(ctx, token.MINT_SIZE, rpc.CommitmentConfirmed)
	if err != nil {
		return solana.PublicKey{}, nil, err
	}

	blockhash, err := c.GetLatestBlockhash(ctx)
	if err != nil {
		return solana.PublicKey{}, nil, err
	}

	tx, err := solana.NewTransaction(
		[]solana.Instruction{
			system.NewCreateAccountInstruction(
				lamports,
				token.MINT_SIZE,
				constants.TokenProgramID,
				payer.PublicKey(),
				mintKp.PublicKey(),
			).Build(),
			token.NewInitializeMint2Instruction(
				decimals,
				payer.PublicKey(),
				solana.PublicKey{}, // no freeze authority
				mintKp.PublicKey(),
			).Build(),
		},
		blockhash,
		solana.TransactionPayer(payer.PublicKey()),
	)
	if err != nil {
		return solana.PublicKey{}, nil, err
	}

	_, err = tx.Sign(func(key solana.PublicKey) *solana.PrivateKey {
		if key == payer.PublicKey() {
			return &payer
		}
		if key == mintKp.PublicKey() {
			pk := mintKp
			return &pk
		}
		return nil
	})
	if err != nil {
		return solana.PublicKey{}, nil, err
	}

	sig, err := c.RPC.SendTransaction(ctx, tx)
	if err != nil {
		return solana.PublicKey{}, nil, err
	}
	if err := c.ConfirmTransaction(ctx, sig); err != nil {
		return solana.PublicKey{}, nil, err
	}

	return mintKp.PublicKey(), mintKp, nil
}

// CreateATA creates an associated token account if it doesn't exist.
func (c *Client) CreateATA(ctx context.Context, payer solana.PrivateKey, owner, mint solana.PublicKey) (solana.PublicKey, error) {
	ata := DeriveATA(owner, mint)

	// Check if already exists
	_, err := c.GetAccountInfo(ctx, ata)
	if err == nil {
		return ata, nil // Already exists
	}

	blockhash, err := c.GetLatestBlockhash(ctx)
	if err != nil {
		return solana.PublicKey{}, err
	}

	// Create ATA instruction
	createIx := solana.NewInstruction(
		constants.AssociatedTokenProgramID,
		solana.AccountMetaSlice{
			{PublicKey: payer.PublicKey(), IsSigner: true, IsWritable: true},
			{PublicKey: ata, IsSigner: false, IsWritable: true},
			{PublicKey: owner, IsSigner: false, IsWritable: false},
			{PublicKey: mint, IsSigner: false, IsWritable: false},
			{PublicKey: constants.SystemProgramID, IsSigner: false, IsWritable: false},
			{PublicKey: constants.TokenProgramID, IsSigner: false, IsWritable: false},
		},
		[]byte{}, // No data for create ATA
	)

	tx, err := solana.NewTransaction(
		[]solana.Instruction{createIx},
		blockhash,
		solana.TransactionPayer(payer.PublicKey()),
	)
	if err != nil {
		return solana.PublicKey{}, err
	}

	_, err = tx.Sign(func(key solana.PublicKey) *solana.PrivateKey {
		if key == payer.PublicKey() {
			return &payer
		}
		return nil
	})
	if err != nil {
		return solana.PublicKey{}, err
	}

	sig, err := c.RPC.SendTransaction(ctx, tx)
	if err != nil {
		return solana.PublicKey{}, err
	}
	if err := c.ConfirmTransaction(ctx, sig); err != nil {
		return solana.PublicKey{}, err
	}

	return ata, nil
}

// GetOrCreateATA gets or creates an ATA.
func (c *Client) GetOrCreateATA(ctx context.Context, payer solana.PrivateKey, owner, mint solana.PublicKey) (solana.PublicKey, error) {
	return c.CreateATA(ctx, payer, owner, mint)
}

// MintTo mints tokens to a destination.
func (c *Client) MintTo(ctx context.Context, authority solana.PrivateKey, mint, dest solana.PublicKey, amount uint64) error {
	blockhash, err := c.GetLatestBlockhash(ctx)
	if err != nil {
		return err
	}

	tx, err := solana.NewTransaction(
		[]solana.Instruction{
			token.NewMintToInstruction(
				amount,
				mint,
				dest,
				authority.PublicKey(),
				nil,
			).Build(),
		},
		blockhash,
		solana.TransactionPayer(authority.PublicKey()),
	)
	if err != nil {
		return err
	}

	_, err = tx.Sign(func(key solana.PublicKey) *solana.PrivateKey {
		if key == authority.PublicKey() {
			return &authority
		}
		return nil
	})
	if err != nil {
		return err
	}

	sig, err := c.RPC.SendTransaction(ctx, tx)
	if err != nil {
		return err
	}
	return c.ConfirmTransaction(ctx, sig)
}

// TransferSOL sends SOL (lamports) from one account to another.
func (c *Client) TransferSOL(ctx context.Context, from solana.PrivateKey, to solana.PublicKey, lamports uint64) (solana.Signature, error) {
	blockhash, err := c.GetLatestBlockhash(ctx)
	if err != nil {
		return solana.Signature{}, err
	}

	tx, err := solana.NewTransaction(
		[]solana.Instruction{
			system.NewTransferInstruction(
				lamports,
				from.PublicKey(),
				to,
			).Build(),
		},
		blockhash,
		solana.TransactionPayer(from.PublicKey()),
	)
	if err != nil {
		return solana.Signature{}, err
	}

	_, err = tx.Sign(func(key solana.PublicKey) *solana.PrivateKey {
		if key == from.PublicKey() {
			return &from
		}
		return nil
	})
	if err != nil {
		return solana.Signature{}, err
	}

	sig, err := c.RPC.SendTransaction(ctx, tx)
	if err != nil {
		return solana.Signature{}, err
	}
	if err := c.ConfirmTransaction(ctx, sig); err != nil {
		return solana.Signature{}, err
	}
	return sig, nil
}

// GetNetworkMints returns all SPL token mint pubkeys on the network.
func (c *Client) GetNetworkMints(ctx context.Context) ([]solana.PublicKey, error) {
	resp, err := c.RPC.GetProgramAccountsWithOpts(ctx, constants.TokenProgramID, &rpc.GetProgramAccountsOpts{
		Filters: []rpc.RPCFilter{
			{DataSize: 82},
		},
	})
	if err != nil {
		return nil, err
	}
	mints := make([]solana.PublicKey, len(resp))
	for i, a := range resp {
		mints[i] = a.Pubkey
	}
	return mints, nil
}
