"use client";

import { useEffect } from "react";
import useSWR from "swr";

import type { Repository } from "@/hooks/useRepositories";

/**
 * Global client-side state for the user's currently-selected repository,
 * stored in the SWR cache under a local (non-fetching) key. Any component
 * calling `useSelectedRepository()` reads/writes the same entry, so there's
 * no prop-drilling or context wiring.
 *
 * Selection is mirrored to `localStorage` so a reload doesn't drop it.
 */

export const SELECTED_REPOSITORY_KEY = "selected-repository";
const STORAGE_KEY = "echobase:selected-repository";

function readStored(): Repository | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Repository) : null;
  } catch {
    return null;
  }
}

export function useSelectedRepository() {
  const { data, mutate } = useSWR<Repository | null>(
    SELECTED_REPOSITORY_KEY,
    null,
    {
      fallbackData: null,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );

  // Hydrate from localStorage once on the client. The SWR `null` fetcher
  // never runs, so we seed the cache manually instead of inside `fetcher`.
  useEffect(() => {
    if (data) return;
    const stored = readStored();
    if (stored) {
      void mutate(stored, false);
    }
    // We intentionally only run this once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    void mutate(repository, false);
  }

  return {
    selectedRepository: data ?? null,
    setSelectedRepository,
  };
}
