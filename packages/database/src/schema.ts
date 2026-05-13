/**
 * Source of truth for database table shapes.
 *
 * Each table is declared as an interface, then registered on the root `DB`
 * interface. Kysely uses `DB` to type queries end-to-end, and we derive
 * row/insert/update aliases from these interfaces in `./types.ts`.
 *
 * Add new tables here; pair every change with a migration in `./migrations`.
 */

import type { ColumnType, Generated } from "kysely";

/**
 * Stores one row per GitHub identity. Populated by the OAuth callback as an
 * upsert keyed by `github_id` (GitHub's numeric user id is stable across
 * username changes, so it's the real identity, not `github_login`).
 *
 * `access_token` is stored encrypted at the application layer with a symmetric
 * key from env — the column type is plain text, the obligation is on the
 * callback code. The token is what gets handed to E2B sandboxes so Claude
 * Haiku agents can clone the user's private repos.
 */
export interface Users {
  id: Generated<string>;
  github_id: string; // bigint — Kysely surfaces it as string to preserve precision
  github_login: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  access_token: string;
  token_scopes: ColumnType<string[], string[] | undefined, string[]>;
  refresh_token: string | null;
  token_expires_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface DB {
  users: Users;
}
