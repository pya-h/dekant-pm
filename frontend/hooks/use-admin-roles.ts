"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { UserRoleEntry } from "@/lib/types";

export function useAdminRoles(token: string | null) {
  return useQuery({
    queryKey: ["adminRoles"],
    queryFn: () => api.get<UserRoleEntry[]>("/admin/roles", undefined, token!),
    enabled: !!token,
    staleTime: 15_000,
  });
}
