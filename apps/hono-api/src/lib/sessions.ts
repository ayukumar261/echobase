import { randomBytes } from "node:crypto";

const TTL_MS = 2 * 60 * 1000;

export interface SessionRecord {
  userId: string;
  repoFullName: string;
  expiresAt: number;
}

const sessions = new Map<string, SessionRecord>();

function gc(): void {
  const now = Date.now();
  for (const [id, rec] of sessions) {
    if (rec.expiresAt <= now) sessions.delete(id);
  }
}

export function createSession(userId: string, repoFullName: string): string {
  gc();
  const id = randomBytes(24).toString("base64url");
  sessions.set(id, {
    userId,
    repoFullName,
    expiresAt: Date.now() + TTL_MS,
  });
  return id;
}

export function consumeSession(id: string): SessionRecord | null {
  gc();
  const rec = sessions.get(id);
  if (!rec) return null;
  sessions.delete(id);
  if (rec.expiresAt <= Date.now()) return null;
  return rec;
}
