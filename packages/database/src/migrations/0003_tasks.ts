import { sql, type Kysely } from "kysely";

/**
 * `tasks` table — one row per implementation spec submitted by a user. The
 * `task` column holds the Markdown spec verbatim; `status` tracks lifecycle
 * through the executor pipeline (pending → queued → running → completed/failed).
 *
 * Status is a plain text column gated by a CHECK constraint rather than a
 * Postgres enum: adding a new state later is a single migration that drops
 * and recreates the check, instead of the `ALTER TYPE ... ADD VALUE` dance
 * (which can't run inside a transaction on older Postgres). The trade-off is
 * the union must stay in sync between this file and `schema.ts`.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("tasks")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("user_id", "uuid", (col) =>
      col.notNull().references("users.id").onDelete("cascade"),
    )
    .addColumn("task", "text", (col) => col.notNull())
    .addColumn("status", "text", (col) =>
      col.notNull().defaultTo("pending"),
    )
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      "tasks_status_check",
      sql`status in ('pending', 'queued', 'running', 'completed', 'failed')`,
    )
    .execute();

  await db.schema
    .createIndex("tasks_user_id_idx")
    .on("tasks")
    .column("user_id")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("tasks").execute();
}
