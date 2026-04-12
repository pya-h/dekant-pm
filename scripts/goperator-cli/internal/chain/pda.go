package chain

import (
	"encoding/binary"

	"goperator-cli/internal/constants"

	"github.com/gagliardetto/solana-go"
)

func FindProtocolConfig(programID solana.PublicKey) (solana.PublicKey, uint8) {
	addr, bump, _ := solana.FindProgramAddress(
		[][]byte{constants.SeedProtocolConfig},
		programID,
	)
	return addr, bump
}

func FindUserRole(user solana.PublicKey, role uint8, programID solana.PublicKey) (solana.PublicKey, uint8) {
	addr, bump, _ := solana.FindProgramAddress(
		[][]byte{constants.SeedUserRole, user.Bytes(), {role}},
		programID,
	)
	return addr, bump
}

func FindMarket(marketID uint64, programID solana.PublicKey) (solana.PublicKey, uint8) {
	buf := make([]byte, 8)
	binary.LittleEndian.PutUint64(buf, marketID)
	addr, bump, _ := solana.FindProgramAddress(
		[][]byte{constants.SeedMarket, buf},
		programID,
	)
	return addr, bump
}

func FindVaultAuthority(market solana.PublicKey, programID solana.PublicKey) (solana.PublicKey, uint8) {
	addr, bump, _ := solana.FindProgramAddress(
		[][]byte{constants.SeedVaultAuthority, market.Bytes()},
		programID,
	)
	return addr, bump
}

func FindUserPosition(market, user solana.PublicKey, programID solana.PublicKey) (solana.PublicKey, uint8) {
	addr, bump, _ := solana.FindProgramAddress(
		[][]byte{constants.SeedUserPosition, market.Bytes(), user.Bytes()},
		programID,
	)
	return addr, bump
}

func FindLpPosition(market, user solana.PublicKey, programID solana.PublicKey) (solana.PublicKey, uint8) {
	addr, bump, _ := solana.FindProgramAddress(
		[][]byte{constants.SeedLpPosition, market.Bytes(), user.Bytes()},
		programID,
	)
	return addr, bump
}
