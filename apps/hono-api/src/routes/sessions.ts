import { Hono } from "hono";
import { getCookie } from "hono/cookie";

import { decrypt } from "../lib/crypto.js";
import { getDb } from "../lib/db.js";
import { consumeSession, createSession } from "../lib/sessions.js";

export const sessionsRoutes = new Hono();

function pipecatWsUrl(): string {
  return process.env.PUBLIC_PIPECAT_WS_URL ?? "ws://localhost:8000/ws";
}

sessionsRoutes.post("/", async (c) => {
  const userId = getCookie(c, "user_id");
  if (!userId) return c.json({ error: "unauthenticated" }, 401);

  let body: { repoFullName?: unknown };
  try {
    body = (await c.req.json()) as { repoFullName?: unknown };
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const repoFullName = body.repoFullName;
  if (
    typeof repoFullName !== "string" ||
    !/^[^/\s]+\/[^/\s]+$/.test(repoFullName)
  ) {
    return c.json({ error: "invalid_repo" }, 400);
  }

  const sessionId = createSession(userId, repoFullName);
  const url = new URL(pipecatWsUrl());
  url.searchParams.set("session", sessionId);
  return c.json({ sessionId, wsUrl: url.toString() });
});

sessionsRoutes.post("/resolve", async (c) => {
  const expected = process.env.PIPECAT_SHARED_SECRET;
  if (!expected) return c.json({ error: "server_misconfigured" }, 500);

  const auth = c.req.header("authorization") ?? "";
  if (auth !== `Bearer ${expected}`) {
    return c.json({ error: "unauthorized" }, 401);
  }

  let body: { sessionId?: unknown };
  try {
    body = (await c.req.json()) as { sessionId?: unknown };
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const sessionId = body.sessionId;
  if (typeof sessionId !== "string" || !sessionId) {
    return c.json({ error: "invalid_session" }, 400);
  }

  const rec = consumeSession(sessionId);
  if (!rec) return c.json({ error: "session_not_found" }, 404);

  const db = getDb();
  const row = await db
    .selectFrom("users")
    .where("id", "=", rec.userId)
    .select(["access_token"])
    .executeTakeFirst();

  if (!row) return c.json({ error: "user_not_found" }, 404);

  const accessToken = decrypt(row.access_token);
  return c.json({
    userId: rec.userId,
    repoFullName: rec.repoFullName,
    cloneUrl: `https://github.com/${rec.repoFullName}.git`,
    accessToken,
  });
});
