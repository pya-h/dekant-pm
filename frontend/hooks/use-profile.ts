"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { UserProfile } from "@/lib/types";

export function useProfile(token: string | null) {
  return useQuery({
    queryKey: ["profile", token],
    queryFn: () => api.get<UserProfile>("/profile", undefined, token!),
    enabled: !!token,
    staleTime: 60_000,
  });
}

export function useUpdateProfile(token: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: { username?: string; email?: string | null; avatar?: string | null }) =>
      api.patch<UserProfile>("/profile", dto, token!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
  });
}
