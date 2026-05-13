"use client";

import { SWRConfig } from "swr";
import { api, ApiError } from "@/lib/api";

async function fetcher<T>(key: string): Promise<T | null> {
  if (!key.startsWith("/")) return null;
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
