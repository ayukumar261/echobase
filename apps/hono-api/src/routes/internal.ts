import { Hono } from "hono";

import { decrypt } from "../lib/crypto.js";
import { getDb } from "../lib/db.js";

/**
 * Internal-only routes consumed by trusted backend services (the BullMQ
 * worker, eventually any other server-side caller). Every handler must
 * gate on the shared-secret header — these endpoints intentionally bypass
 * the cookie-based auth used by user-facing routes.
 */
export const internalRoutes = new Hono();

function requireSharedSecret(authHeader: string | undefined): boolean {
  const expected = process.env.WORKER_SHARED_SECRET;
  if (!expected) return false;
  return authHeader === `Bearer ${expected}`;
}

/**
 * Decrypts a user's GitHub access token and returns it alongside their
 * `github_login`. The worker uses both to (a) build the authed clone URL
 * (`https://x-access-token:{token}@github.com/...`) and (b) set the
 * `git config user.name` inside the sandbox so commits are attributed to
 * the human, not the bot.
 *
 * The encryption key (`TOKEN_ENCRYPTION_KEY`) stays on the API side; the
 * worker never has to know about it.
 */
internalRoutes.post("/github-token", async (c) => {
  if (!process.env.WORKER_SHARED_SECRET) {
    return c.json({ error: "server_misconfigured" }, 500);
  }
  if (!requireSharedSecret(c.req.header("authorization"))) {
    return c.json({ error: "unauthorized" }, 401);
  }

  let body: { userId?: unknown };
  try {
    body = (await c.req.json()) as { userId?: unknown };
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const userId = body.userId;
  if (typeof userId !== "string" || !userId) {
    return c.json({ error: "invalid_user" }, 400);
  }

  const db = getDb();
  const row = await db
    .selectFrom("users")
    .where("id", "=", userId)
    .select(["access_token", "github_login", "email"])
    .executeTakeFirst();

  if (!row) return c.json({ error: "user_not_found" }, 404);

  let accessToken: string;
  try {
    accessToken = decrypt(row.access_token);
  } catch (err) {
    console.error("[internal] failed to decrypt access_token for", userId, err);
    return c.json({ error: "token_decrypt_failed" }, 500);
  }

  return c.json({
    accessToken,
    login: row.github_login,
    email: row.email,
  });
});
