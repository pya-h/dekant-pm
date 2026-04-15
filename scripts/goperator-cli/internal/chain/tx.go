package chain

import (
	"context"
	"encoding/binary"
	"fmt"
	"math"
	"math/big"

	"goperator-cli/internal/constants"

	"github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
)

// Instruction holds the data for a custom program instruction.
type Instruction struct {
	programID solana.PublicKey
	accounts  solana.AccountMetaSlice
	data      []byte
}

func (i *Instruction) ProgramID() solana.PublicKey     { return i.programID }
func (i *Instruction) Accounts() []*solana.AccountMeta { return i.accounts }
func (i *Instruction) Data() ([]byte, error)           { return i.data, nil }

// BuildInstruction creates a program instruction with discriminator and serialized args.
func BuildInstruction(programID solana.PublicKey, disc [8]byte, args []byte, accounts solana.AccountMetaSlice) *Instruction {
	data := make([]byte, 0, 8+len(args))
	data = append(data, disc[:]...)
	data = append(data, args...)
	return &Instruction{
		programID: programID,
		accounts:  accounts,
		data:      data,
	}
}

// ComputeBudgetInstruction creates a SetComputeUnitLimit instruction.
func ComputeBudgetInstruction(units uint32) *Instruction {
	computeBudgetProgramID := solana.MustPublicKeyFromBase58("ComputeBudget111111111111111111111111111111")
	data := make([]byte, 5)
	data[0] = 2 // SetComputeUnitLimit variant
	binary.LittleEndian.PutUint32(data[1:5], units)
	return &Instruction{
		programID: computeBudgetProgramID,
		accounts:  nil,
		data:      data,
	}
}

// SendAndConfirm builds, signs, sends, and confirms a transaction.
func (c *Client) SendAndConfirm(ctx context.Context, instructions []solana.Instruction, signers []solana.PrivateKey, payer solana.PublicKey) (solana.Signature, error) {
	blockhash, err := c.GetLatestBlockhash(ctx)
	if err != nil {
		return solana.Signature{}, fmt.Errorf("get blockhash: %w", err)
	}

	tx, err := solana.NewTransaction(instructions, blockhash, solana.TransactionPayer(payer))
	if err != nil {
		return solana.Signature{}, fmt.Errorf("build tx: %w", err)
	}

	_, err = tx.Sign(func(key solana.PublicKey) *solana.PrivateKey {
		for i := range signers {
			if signers[i].PublicKey() == key {
				return &signers[i]
			}
		}
		return nil
	})
	if err != nil {
		return solana.Signature{}, fmt.Errorf("sign tx: %w", err)
	}

	opts := rpc.TransactionOpts{
		SkipPreflight: true,
	}
	sig, err := c.RPC.SendTransactionWithOpts(ctx, tx, opts)
	if err != nil {
		return solana.Signature{}, fmt.Errorf("send tx: %w", err)
	}

	if err := c.ConfirmTransaction(ctx, sig); err != nil {
		return sig, fmt.Errorf("confirm tx: %w", err)
	}

	return sig, nil
}

// ── Borsh Encoding Helpers ──────────────────────────────────────────────────

// EncodeU8 encodes a uint8 to bytes.
func EncodeU8(v uint8) []byte {
	return []byte{v}
}

// EncodeU16LE encodes a uint16 to little-endian bytes.
func EncodeU16LE(v uint16) []byte {
	buf := make([]byte, 2)
	binary.LittleEndian.PutUint16(buf, v)
	return buf
}

// EncodeU64LE encodes a uint64 to little-endian bytes.
func EncodeU64LE(v uint64) []byte {
	buf := make([]byte, 8)
	binary.LittleEndian.PutUint64(buf, v)
	return buf
}

// EncodeI64LE encodes an int64 to little-endian bytes.
func EncodeI64LE(v int64) []byte {
	buf := make([]byte, 8)
	binary.LittleEndian.PutUint64(buf, uint64(v))
	return buf
}

// EncodeU128LE encodes a *big.Int as a 16-byte little-endian value.
func EncodeU128LE(v *big.Int) []byte {
	buf := make([]byte, 16)
	if v == nil {
		return buf
	}
	bytes := v.Bytes()
	// big.Int.Bytes() is big-endian, we need little-endian
	for i, j := 0, len(bytes)-1; i < j; i, j = i+1, j-1 {
		bytes[i], bytes[j] = bytes[j], bytes[i]
	}
	copy(buf, bytes)
	return buf
}

// EncodePubkey encodes a public key to bytes.
func EncodePubkey(pk solana.PublicKey) []byte {
	return pk.Bytes()
}

// EncodeBool encodes a bool to a single byte.
func EncodeBool(v bool) []byte {
	if v {
		return []byte{1}
	}
	return []byte{0}
}

// ── Borsh Decoding Helpers ──────────────────────────────────────────────────

func DecodeU8(data []byte, offset int) (uint8, int) {
	return data[offset], offset + 1
}

func DecodeU16LE(data []byte, offset int) (uint16, int) {
	return binary.LittleEndian.Uint16(data[offset:]), offset + 2
}

func DecodeU64LE(data []byte, offset int) (uint64, int) {
	return binary.LittleEndian.Uint64(data[offset:]), offset + 8
}

func DecodeI64LE(data []byte, offset int) (int64, int) {
	return int64(binary.LittleEndian.Uint64(data[offset:])), offset + 8
}

func DecodeU128LE(data []byte, offset int) (*big.Int, int) {
	// Read 16 bytes in little-endian
	buf := make([]byte, 16)
	copy(buf, data[offset:offset+16])
	// Reverse to big-endian for big.Int
	for i, j := 0, len(buf)-1; i < j; i, j = i+1, j-1 {
		buf[i], buf[j] = buf[j], buf[i]
	}
	v := new(big.Int).SetBytes(buf)
	return v, offset + 16
}

func DecodePubkey(data []byte, offset int) (solana.PublicKey, int) {
	pk := solana.PublicKeyFromBytes(data[offset : offset+32])
	return pk, offset + 32
}

func DecodeBool(data []byte, offset int) (bool, int) {
	return data[offset] != 0, offset + 1
}

// DecodeVecU64 decodes a Borsh Vec<u64>: 4-byte LE length, then N * 8-byte LE u64 values.
func DecodeVecU64(data []byte, offset int) ([]uint64, int) {
	length := binary.LittleEndian.Uint32(data[offset:])
	offset += 4
	result := make([]uint64, length)
	for i := uint32(0); i < length; i++ {
		result[i] = binary.LittleEndian.Uint64(data[offset:])
		offset += 8
	}
	return result, offset
}

// ScaleToFloat converts a SCALE-denominated value to float.
func ScaleToFloat(v int64) float64 {
	return float64(v) / float64(constants.SCALE)
}

// FloatToScale converts a float to SCALE-denominated value.
func FloatToScale(v float64) int64 {
	return int64(math.Round(v * float64(constants.SCALE)))
}
