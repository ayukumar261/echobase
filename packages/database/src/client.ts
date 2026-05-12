import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";

import type { DB } from "./schema.js";

export type Db = Kysely<DB>;

/**
 * Create a typed Kysely client backed by node-postgres.
 *
 * Callers own the lifecycle: hold the returned instance for the lifetime of
 * the process and call `db.destroy()` on shutdown to drain the pool.
 */
export function createDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString });
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool }),
  });
}
