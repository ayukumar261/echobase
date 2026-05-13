import { sql, type Kysely } from "kysely";

/**
 * `users` table — one row per GitHub identity, keyed internally by `id` (uuid)
 * and externally by `github_id` (GitHub's stable numeric user id). The OAuth
 * callback upserts on `github_id`. `access_token` is encrypted at the
 * application layer before insert; the column itself is plain text.
 */

export async function up(db: Kysely<unknown>): Promise<void> {
  // gen_random_uuid() lives in pgcrypto on Postgres < 13; safe to enable
  // unconditionally.
  await sql`create extension if not exists pgcrypto`.execute(db);

  await db.schema
    .createTable("users")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("github_id", "bigint", (col) => col.notNull().unique())
    .addColumn("github_login", "text", (col) => col.notNull())
    .addColumn("email", "text")
    .addColumn("name", "text")
    .addColumn("avatar_url", "text")
    .addColumn("access_token", "text", (col) => col.notNull())
    .addColumn("token_scopes", sql`text[]`, (col) =>
      col.notNull().defaultTo(sql`'{}'::text[]`),
    )
    .addColumn("refresh_token", "text")
    .addColumn("token_expires_at", "timestamptz")
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("users").execute();
}
