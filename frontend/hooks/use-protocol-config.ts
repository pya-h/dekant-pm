"use client";

import { useQuery } from "@tanstack/react-query";
import { useProgram, deriveProtocolConfig } from "@/lib/solana";

export function useProtocolConfig() {
  const program = useProgram();

  return useQuery({
    queryKey: ["protocolConfig"],
    queryFn: async () => {
      if (!program) throw new Error("Program not ready");
      const [pda] = deriveProtocolConfig();
      return program.account.protocolConfig.fetch(pda);
    },
    enabled: !!program,
    staleTime: 30_000,
  });
}
