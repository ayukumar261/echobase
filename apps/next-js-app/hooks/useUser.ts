"use client";

import useSWR from "swr";

// Sanitized shape returned by GET /api/user/me — keep in sync with the column
// selection in apps/hono-api/src/routes/user.ts. Inlined (rather than imported
// from @repo/database) to keep the client bundle free of pg/kysely runtime.
export type CurrentUser = {
  id: string;
  github_id: string;
  github_login: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
};

export const USER_KEY = "/api/user/me";

export function useUser() {
  const { data, error, isLoading, mutate } = useSWR<CurrentUser | null>(
    USER_KEY,
  );

  return {
    user: data ?? null,
    isLoading,
    isLoggedIn: !!data,
    error,
    mutate,
  };
}
