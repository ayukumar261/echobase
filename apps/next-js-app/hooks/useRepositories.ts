"use client";

import useSWR from "swr";

// Shape returned by GET /api/user/repositories. Keep in sync with the mapper
// in apps/hono-api/src/lib/github.ts (`GithubRepository`). Inlined rather than
// imported so the client bundle stays free of server-only deps.
export type Repository = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  pushed_at: string | null;
  owner: { login: string; avatar_url: string };
};

export const REPOSITORIES_KEY = "/api/user/repositories";

export function useRepositories() {
  const { data, error, isLoading, mutate } = useSWR<{
    repositories: Repository[];
  } | null>(REPOSITORIES_KEY);

  return {
    repositories: data?.repositories ?? [],
    isLoading,
    error,
    mutate,
  };
}
