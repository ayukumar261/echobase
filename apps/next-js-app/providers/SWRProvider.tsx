"use client";

import { SWRConfig } from "swr";
import { api, ApiError } from "@/lib/api";

// SWR fetcher delegates to our typed fetch wrapper so `credentials: 'include'`
// and ApiError parsing stay consistent with non-SWR calls. A 401 on a
// nullable resource (like `/api/user/me`) is treated as "no data" rather
// than an error — keeps consumer hooks ergonomic.
async function fetcher<T>(key: string): Promise<T | null> {
  try {
    return await api.get<T>(key);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{ fetcher, shouldRetryOnError: false }}>
      {children}
    </SWRConfig>
  );
}
