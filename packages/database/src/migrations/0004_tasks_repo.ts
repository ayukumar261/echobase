import { sql, type Kysely } from "kysely";

/**
 * Link tasks to a GitHub repo. Adds:
 *   - `repository`  — `owner/repo` form, required. The worker clones this into
 *                     an E2B sandbox before invoking the agent loop.
 *   - `base_branch` — base branch for the eventual draft PR. Defaults to `main`
 *                     because that's overwhelmingly the convention; users on
 *                     `master` or release branches pass it explicitly.
 *
 * Both columns are NOT NULL so the worker never has to defend against missing
 * targets at job time. The default on `base_branch` lets backfill succeed
 * without scanning every existing row.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
  // Add with a sentinel default so any pre-existing rows backfill cleanly, then
  // drop the default so future inserts must be explicit. New rows from the API
  // path always supply `repository` (see `POST /api/tasks`).
  await db.schema
    .alterTable("tasks")
    .addColumn("repository", "text", (col) =>
      col.notNull().defaultTo("unknown/unknown"),
    )
    .addColumn("base_branch", "text", (col) => col.notNull().defaultTo("main"))
    .execute();

  await sql`alter table tasks alter column repository drop default`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable("tasks")
    .dropColumn("repository")
    .dropColumn("base_branch")
    .execute();
}
