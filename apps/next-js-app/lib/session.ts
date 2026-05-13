import { api } from "@/lib/api";

export async function createSession(
  repoFullName: string,
): Promise<{ sessionId: string; wsUrl: string }> {
  return api.post<{ sessionId: string; wsUrl: string }>("/api/sessions", {
    repoFullName,
  });
}
