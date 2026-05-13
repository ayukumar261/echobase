"use client";

import useSWR from "swr";

import type { Repository } from "@/hooks/useRepositories";

/**
 * Global client-side state for the user's currently-selected repository,
 * stored in the SWR cache under a local (non-fetching) key. Any component
 * calling `useSelectedRepository()` reads/writes the same entry, so there's
 * no prop-drilling or context wiring.
 */

export const SELECTED_REPOSITORY_KEY = "selected-repository";
const STORAGE_KEY = "echobase:selected-repository";

let hydratedFallback: Repository | null | undefined;

function readStored(): Repository | null {
  if (typeof window === "undefined") return null;
  if (hydratedFallback !== undefined) return hydratedFallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    hydratedFallback = raw ? (JSON.parse(raw) as Repository) : null;
  } catch {
    hydratedFallback = null;
  }
  return hydratedFallback;
}

export function useSelectedRepository() {
  const { data, mutate } = useSWR<Repository | null>(
    SELECTED_REPOSITORY_KEY,
    null,
    {
      fallbackData: readStored(),
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );

  function setSelectedRepository(repository: Repository | null) {
    if (typeof window !== "undefined") {
      try {
        if (repository) {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(repository));
        } else {
          window.localStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        // localStorage can throw in private-mode Safari — selection still
        // works for the lifetime of the tab via the SWR cache.
      }
    }
    hydratedFallback = repository;
    void mutate(repository, false);
  }

  return {
    selectedRepository: data ?? null,
    setSelectedRepository,
  };
}
