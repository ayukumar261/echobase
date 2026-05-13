import { Hono } from "hono";
import { getCookie } from "hono/cookie";

import { getDb } from "../lib/db.js";
import { tasksQueue } from "../lib/queue.js";

export const tasksRoutes = new Hono();

tasksRoutes.post("/", async (c) => {
  const userId = getCookie(c, "user_id");
  if (!userId) return c.json({ error: "unauthenticated" }, 401);

  let body: { task?: unknown };
  try {
    body = (await c.req.json()) as { task?: unknown };
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const task = body.task;
  if (typeof task !== "string" || task.trim().length === 0) {
    return c.json({ error: "invalid_task" }, 400);
  }

  const db = getDb();
  const row = await db
    .insertInto("tasks")
    .values({ user_id: userId, task, status: "pending" })
    .returningAll()
    .executeTakeFirstOrThrow();

  try {
    // Race against an explicit timeout — when Redis is unreachable, ioredis
    // retries the socket indefinitely and `add` would otherwise hang the
    // request forever instead of falling through to the 503 path.
    await Promise.race([
      tasksQueue.add(
        "process",
        { taskId: row.id, userId },
        {
          removeOnComplete: true,
          attempts: 3,
          backoff: { type: "exponential", delay: 1000 },
        },
      ),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("enqueue_timeout")), 2000),
      ),
    ]);
  } catch (err) {
    console.error("[tasks] enqueue failed; rolling back row", row.id, err);
    try {
      await db.deleteFrom("tasks").where("id", "=", row.id).execute();
    } catch (rollbackErr) {
      console.error(
        "[tasks] rollback delete failed for row",
        row.id,
        rollbackErr,
      );
    }
    return c.json({ error: "queue_unavailable" }, 503);
  }

  const queued = await db
    .updateTable("tasks")
    .set({ status: "queued", updated_at: new Date() })
    .where("id", "=", row.id)
    .returningAll()
    .executeTakeFirstOrThrow();

  return c.json(queued, 201);
});
