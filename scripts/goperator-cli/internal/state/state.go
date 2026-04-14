package state

import (
	"context"
	"fmt"
	"math/big"
	"time"

	"goperator-cli/internal/chain"
	"goperator-cli/internal/random"

	"github.com/gagliardetto/solana-go"
)

// User represents a session user.
type User struct {
	Label   string
	Keypair solana.PrivateKey
	Pubkey  solana.PublicKey
	Roles   []string
}

// SessionMarket represents a market tracked in the session.
type SessionMarket struct {
	ID          uint64
	Label       string
	Type        uint8
	Mint        solana.PublicKey
	Oracle      solana.PublicKey
	NumOutcomes int
	RangeMin    float64
	RangeMax    float64
}

// TxLogEntry represents a transaction log entry.
type TxLogEntry struct {
	Time    time.Time
	Action  string
	Sig     string
	Success bool
	Detail  string
}

// ProtocolConfig represents the on-chain protocol config.
type ProtocolConfig struct {
	Version          uint8
	Superadmin       solana.PublicKey
	Treasury         solana.PublicKey
	MarketCount      uint64
	CreationFeeBps   uint16
	TradeFeeBps      uint16
	RedemptionFeeBps uint16
	LpFeeShareBps   uint16
	Bump             uint8
}

// MarketAccount represents the on-chain market account.
type MarketAccount struct {
	Version                uint8
	MarketID               uint64
	MarketType             uint8
	State                  uint8
	Creator                solana.PublicKey
	Oracle                 solana.PublicKey
	CollateralMint         solana.PublicKey
	Vault                  solana.PublicKey
	Deadline               int64
	CreatedAt              int64
	ResolvedAt             int64
	NumOutcomes            uint16
	KSquared               *big.Int
	TotalMinted            *big.Int
	LpSharesTotal          *big.Int
	LpFeeAccumulated       *big.Int
	ProtocolFeeAccumulated uint64
	RangeMin               int64
	RangeMax               int64
	ResolvedOutcome        uint16
	ResolvedValue          int64
	Bump                   uint8
	VaultAuthorityBump     uint8
	Reserves               []uint64
}

// UserPositionAccount represents the on-chain user position account.
type UserPositionAccount struct {
	Version        uint8
	Market         solana.PublicKey
	User           solana.PublicKey
	TotalDeposited uint64
	TotalWithdrawn uint64
	Claimed        bool
	Bump           uint8
	Holdings       []uint64
}

// LpPositionAccount represents the on-chain LP position account.
type LpPositionAccount struct {
	Version             uint8
	Market              solana.PublicKey
	User                solana.PublicKey
	Shares              *big.Int
	DepositedCollateral uint64
	Bump                uint8
}

// UserRoleAccount represents the on-chain user role account.
type UserRoleAccount struct {
	Version    uint8
	User       solana.PublicKey
	Role       uint8
	AssignedBy solana.PublicKey
	AssignedAt int64
	Bump       uint8
}

// SessionState holds all session data.
type SessionState struct {
	Users      []User
	Markets    []SessionMarket
	Superuser  User
	Client     *chain.Client
	ProgramID  solana.PublicKey
	RandomMode bool
	TxLog      []TxLogEntry
}

// NewSessionState creates a new session state from config.
func NewSessionState(rpcURL string, programID solana.PublicKey, keypairPath string) (*SessionState, error) {
	kp, err := chain.LoadKeypair(keypairPath)
	if err != nil {
		return nil, fmt.Errorf("load superuser keypair: %w", err)
	}

	client := chain.NewClient(rpcURL, programID)

	return &SessionState{
		Users:   make([]User, 0),
		Markets: make([]SessionMarket, 0),
		Superuser: User{
			Label:   "Superuser",
			Keypair: kp,
			Pubkey:  kp.PublicKey(),
		},
		Client:    client,
		ProgramID: programID,
		TxLog:     make([]TxLogEntry, 0),
	}, nil
}

// VerifyProtocol checks that the protocol is initialized.
func (s *SessionState) VerifyProtocol() error {
	protocolConfig, _ := chain.FindProtocolConfig(s.ProgramID)
	ctx := context.Background()
	_, err := s.Client.GetAccountInfo(ctx, protocolConfig)
	if err != nil {
		return fmt.Errorf("protocol not initialized. Run: cd devkit && npx ts-node src/setup.ts init")
	}
	return nil
}

// NextUserLabel returns the next default user label.
func (s *SessionState) NextUserLabel() string {
	return fmt.Sprintf("User %d", len(s.Users)+1)
}

// FindUser finds a user by pubkey.
func (s *SessionState) FindUser(pubkey solana.PublicKey) *User {
	for i := range s.Users {
		if s.Users[i].Pubkey == pubkey {
			return &s.Users[i]
		}
	}
	return nil
}

// AddTxLog adds a transaction log entry.
func (s *SessionState) AddTxLog(action string, sig solana.Signature, success bool, detail string) {
	s.TxLog = append(s.TxLog, TxLogEntry{
		Time:    time.Now(),
		Action:  action,
		Sig:     sig.String(),
		Success: success,
		Detail:  detail,
	})
}

// FetchProtocolConfig fetches and deserializes the protocol config.
func (s *SessionState) FetchProtocolConfig() (*ProtocolConfig, error) {
	addr, _ := chain.FindProtocolConfig(s.ProgramID)
	ctx := context.Background()
	data, err := s.Client.GetAccountInfo(ctx, addr)
	if err != nil {
		return nil, err
	}
	return DeserializeProtocolConfig(data)
}

// FetchMarket fetches and deserializes a market account.
func (s *SessionState) FetchMarket(marketID uint64) (*MarketAccount, solana.PublicKey, error) {
	addr, _ := chain.FindMarket(marketID, s.ProgramID)
	ctx := context.Background()
	data, err := s.Client.GetAccountInfo(ctx, addr)
	if err != nil {
		return nil, addr, err
	}
	market, err := DeserializeMarket(data)
	return market, addr, err
}

// FetchUserPosition fetches and deserializes a user position.
func (s *SessionState) FetchUserPosition(marketPda, user solana.PublicKey) (*UserPositionAccount, solana.PublicKey, error) {
	addr, _ := chain.FindUserPosition(marketPda, user, s.ProgramID)
	ctx := context.Background()
	data, err := s.Client.GetAccountInfo(ctx, addr)
	if err != nil {
		return nil, addr, err
	}
	pos, err := DeserializeUserPosition(data)
	return pos, addr, err
}

// FetchLpPosition fetches and deserializes an LP position.
func (s *SessionState) FetchLpPosition(marketPda, user solana.PublicKey) (*LpPositionAccount, solana.PublicKey, error) {
	addr, _ := chain.FindLpPosition(marketPda, user, s.ProgramID)
	ctx := context.Background()
	data, err := s.Client.GetAccountInfo(ctx, addr)
	if err != nil {
		return nil, addr, err
	}
	lp, err := DeserializeLpPosition(data)
	return lp, addr, err
}

// ── Deserialization ─────────────────────────────────────────────────────────

// DeserializeProtocolConfig deserializes raw account data into ProtocolConfig.
func DeserializeProtocolConfig(data []byte) (*ProtocolConfig, error) {
	if len(data) < 8 {
		return nil, fmt.Errorf("data too short for protocol config")
	}
	// Skip 8-byte discriminator
	off := 8
	pc := &ProtocolConfig{}
	pc.Version, off = chain.DecodeU8(data, off)
	pc.Superadmin, off = chain.DecodePubkey(data, off)
	pc.Treasury, off = chain.DecodePubkey(data, off)
	pc.MarketCount, off = chain.DecodeU64LE(data, off)
	pc.CreationFeeBps, off = chain.DecodeU16LE(data, off)
	pc.TradeFeeBps, off = chain.DecodeU16LE(data, off)
	pc.RedemptionFeeBps, off = chain.DecodeU16LE(data, off)
	pc.LpFeeShareBps, off = chain.DecodeU16LE(data, off)
	pc.Bump, _ = chain.DecodeU8(data, off)
	return pc, nil
}

// DeserializeMarket deserializes raw account data into MarketAccount.
func DeserializeMarket(data []byte) (*MarketAccount, error) {
	if len(data) < 8 {
		return nil, fmt.Errorf("data too short for market")
	}
	// Skip 8-byte discriminator
	off := 8
	m := &MarketAccount{}
	m.Version, off = chain.DecodeU8(data, off)
	m.MarketID, off = chain.DecodeU64LE(data, off)
	m.MarketType, off = chain.DecodeU8(data, off)
	m.State, off = chain.DecodeU8(data, off)
	m.Creator, off = chain.DecodePubkey(data, off)
	m.Oracle, off = chain.DecodePubkey(data, off)
	m.CollateralMint, off = chain.DecodePubkey(data, off)
	m.Vault, off = chain.DecodePubkey(data, off)
	m.Deadline, off = chain.DecodeI64LE(data, off)
	m.CreatedAt, off = chain.DecodeI64LE(data, off)
	m.ResolvedAt, off = chain.DecodeI64LE(data, off)
	m.NumOutcomes, off = chain.DecodeU16LE(data, off)
	m.KSquared, off = chain.DecodeU128LE(data, off)
	m.TotalMinted, off = chain.DecodeU128LE(data, off)
	m.LpSharesTotal, off = chain.DecodeU128LE(data, off)
	m.LpFeeAccumulated, off = chain.DecodeU128LE(data, off)
	m.ProtocolFeeAccumulated, off = chain.DecodeU64LE(data, off)
	m.RangeMin, off = chain.DecodeI64LE(data, off)
	m.RangeMax, off = chain.DecodeI64LE(data, off)
	m.ResolvedOutcome, off = chain.DecodeU16LE(data, off)
	m.ResolvedValue, off = chain.DecodeI64LE(data, off)
	m.Bump, off = chain.DecodeU8(data, off)
	m.VaultAuthorityBump, off = chain.DecodeU8(data, off)
	off += 30 // _padding
	m.Reserves, _ = chain.DecodeVecU64(data, off)
	return m, nil
}

// DeserializeUserPosition deserializes raw account data into UserPositionAccount.
func DeserializeUserPosition(data []byte) (*UserPositionAccount, error) {
	if len(data) < 8 {
		return nil, fmt.Errorf("data too short for user position")
	}
	off := 8 // skip discriminator
	up := &UserPositionAccount{}
	up.Version, off = chain.DecodeU8(data, off)
	up.Market, off = chain.DecodePubkey(data, off)
	up.User, off = chain.DecodePubkey(data, off)
	up.TotalDeposited, off = chain.DecodeU64LE(data, off)
	up.TotalWithdrawn, off = chain.DecodeU64LE(data, off)
	up.Claimed, off = chain.DecodeBool(data, off)
	up.Bump, off = chain.DecodeU8(data, off)
	off += 16 // _padding
	up.Holdings, _ = chain.DecodeVecU64(data, off)
	return up, nil
}

// DeserializeLpPosition deserializes raw account data into LpPositionAccount.
func DeserializeLpPosition(data []byte) (*LpPositionAccount, error) {
	if len(data) < 8 {
		return nil, fmt.Errorf("data too short for lp position")
	}
	off := 8 // skip discriminator
	lp := &LpPositionAccount{}
	lp.Version, off = chain.DecodeU8(data, off)
	lp.Market, off = chain.DecodePubkey(data, off)
	lp.User, off = chain.DecodePubkey(data, off)
	lp.Shares, off = chain.DecodeU128LE(data, off)
	lp.DepositedCollateral, off = chain.DecodeU64LE(data, off)
	lp.Bump, _ = chain.DecodeU8(data, off)
	return lp, nil
}

// DeserializeUserRole deserializes raw account data into UserRoleAccount.
func DeserializeUserRole(data []byte) (*UserRoleAccount, error) {
	if len(data) < 8 {
		return nil, fmt.Errorf("data too short for user role")
	}
	off := 8 // skip discriminator
	ur := &UserRoleAccount{}
	ur.Version, off = chain.DecodeU8(data, off)
	ur.User, off = chain.DecodePubkey(data, off)
	ur.Role, off = chain.DecodeU8(data, off)
	ur.AssignedBy, off = chain.DecodePubkey(data, off)
	ur.AssignedAt, off = chain.DecodeI64LE(data, off)
	ur.Bump, _ = chain.DecodeU8(data, off)
	return ur, nil
}
