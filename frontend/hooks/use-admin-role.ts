"use client";

import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { useProgram, deriveProtocolConfig, deriveUserRole } from "@/lib/solana";
import { Role } from "@/lib/types";

export function useAdminRole() {
  const program = useProgram();
  const { publicKey } = useWallet();

  const { data, isLoading } = useQuery({
    queryKey: ["adminRole", publicKey?.toBase58()],
    queryFn: async () => {
      if (!program || !publicKey) {
        return { isSuperadmin: false, isAdmin: false, isCreator: false };
      }

      const [configPda] = deriveProtocolConfig();
      let isSuperadmin = false;
      let isAdmin = false;
      let isCreator = false;
      let isOracle = false;

      try {
        const config = await program.account.protocolConfig.fetch(configPda);
        isSuperadmin = config.superadmin.equals(publicKey);
      } catch {
        // ProtocolConfig not found — protocol not initialized
      }

      if (!isSuperadmin) {
        try {
          const [adminRolePda] = deriveUserRole(publicKey, Role.Admin);
          const role = await program.account.userRole.fetchNullable(adminRolePda);
          isAdmin = role !== null;
        } catch {
          // UserRole fetch failed — not admin
        }
      }

      if (!isSuperadmin && !isAdmin) {
        try {
          const [creatorRolePda] = deriveUserRole(publicKey, Role.Creator);
          const role = await program.account.userRole.fetchNullable(creatorRolePda);
          isCreator = role !== null;
        } catch {
          // UserRole fetch failed — not creator
        }
      }

      // Oracle is a separate role — check independently of admin/creator
      try {
        const [oracleRolePda] = deriveUserRole(publicKey, Role.Oracle);
        const role = await program.account.userRole.fetchNullable(oracleRolePda);
        isOracle = role !== null;
      } catch {
        // UserRole fetch failed — not oracle
      }

      return { isSuperadmin, isAdmin, isCreator, isOracle };
    },
    enabled: !!program && !!publicKey,
    staleTime: 60_000,
  });

  return {
    isSuperadmin: data?.isSuperadmin ?? false,
    isAdmin: data?.isAdmin ?? false,
    isCreator: data?.isCreator ?? false,
    isOracle: data?.isOracle ?? false,
    isAuthorized: (data?.isSuperadmin || data?.isAdmin) ?? false,
    isLoading,
  };
}
