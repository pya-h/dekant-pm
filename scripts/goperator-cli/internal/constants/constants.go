package constants

import "github.com/gagliardetto/solana-go"

// Scale factor for fixed-point math (10^9)
const SCALE uint64 = 1_000_000_000
const USDC_DECIMALS = 6

// PDA Seeds
var (
	SeedProtocolConfig = []byte("protocol_config")
	SeedUserRole       = []byte("user_role")
	SeedMarket         = []byte("market")
	SeedVaultAuthority = []byte("vault_authority")
	SeedUserPosition   = []byte("user_position")
	SeedLpPosition     = []byte("lp_position")
)

// Roles
const (
	RoleAdmin   uint8 = 1
	RoleOracle  uint8 = 2
	RoleCreator uint8 = 3
)

var RoleNames = map[uint8]string{
	RoleAdmin:   "Admin",
	RoleOracle:  "Oracle",
	RoleCreator: "Creator",
}

// Market Types
const (
	MarketTypeBinary     uint8 = 0
	MarketTypeMulti      uint8 = 1
	MarketTypeContinuous uint8 = 2
)

var MarketTypeNames = map[uint8]string{
	MarketTypeBinary:     "Binary",
	MarketTypeMulti:      "Multi-outcome",
	MarketTypeContinuous: "Continuous",
}

// Market States
const (
	MarketStateActive   uint8 = 0
	MarketStatePaused   uint8 = 1
	MarketStatePending  uint8 = 2
	MarketStateResolved uint8 = 3
)

var MarketStateNames = map[uint8]string{
	MarketStateActive:   "Active",
	MarketStatePaused:   "Paused",
	MarketStatePending:  "PendingResolution",
	MarketStateResolved: "Resolved",
}

// Well-known Program IDs
var (
	TokenProgramID           = solana.MustPublicKeyFromBase58("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
	AssociatedTokenProgramID = solana.MustPublicKeyFromBase58("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
	SystemProgramID          = solana.SystemProgramID
	SysvarRentID             = solana.SysVarRentPubkey
	NativeMint               = solana.MustPublicKeyFromBase58("So11111111111111111111111111111111111111112")
)

// Instruction Discriminators (first 8 bytes of sha256("global:<snake_case_name>"))
var (
	DiscAddLiquidity    = [8]byte{181, 157, 89, 67, 143, 182, 52, 72}
	DiscAssignRole      = [8]byte{255, 174, 125, 180, 203, 155, 202, 131}
	DiscBuy             = [8]byte{102, 6, 61, 18, 1, 218, 235, 234}
	DiscBuyDistribution = [8]byte{81, 82, 164, 124, 2, 240, 199, 229}
	DiscBuyToPrice      = [8]byte{35, 254, 253, 143, 228, 169, 99, 124}
	DiscClaimPayout     = [8]byte{127, 240, 132, 62, 227, 198, 146, 133}
	DiscCollectFees     = [8]byte{164, 152, 207, 99, 30, 186, 19, 182}
	DiscCreateMarket    = [8]byte{103, 226, 97, 235, 200, 188, 251, 254}
	DiscInitialize      = [8]byte{175, 175, 109, 31, 13, 152, 155, 237}
	DiscPauseMarket     = [8]byte{216, 238, 4, 164, 65, 11, 162, 91}
	DiscRemoveLiquidity = [8]byte{80, 85, 209, 72, 24, 206, 177, 108}
	DiscResolveMarket   = [8]byte{155, 23, 80, 173, 46, 74, 23, 239}
	DiscRevokeRole      = [8]byte{179, 232, 2, 180, 48, 227, 82, 7}
	DiscSell            = [8]byte{51, 230, 133, 164, 1, 127, 131, 173}
	DiscSellDistribution = [8]byte{232, 149, 36, 68, 96, 184, 140, 73}
	DiscSellToPrice     = [8]byte{69, 149, 213, 52, 140, 91, 216, 237}
	DiscUnpauseMarket   = [8]byte{219, 203, 199, 170, 212, 45, 170, 80}
	DiscUpdateFees      = [8]byte{225, 27, 13, 6, 69, 84, 172, 191}
)

// Account Discriminators
var (
	AccDiscLpPosition     = [8]byte{105, 241, 37, 200, 224, 2, 252, 90}
	AccDiscMarket         = [8]byte{219, 190, 213, 55, 0, 227, 198, 154}
	AccDiscProtocolConfig = [8]byte{207, 91, 250, 28, 152, 179, 215, 209}
	AccDiscUserPosition   = [8]byte{251, 248, 209, 245, 83, 234, 17, 27}
	AccDiscUserRole       = [8]byte{62, 252, 194, 137, 183, 165, 147, 28}
)
