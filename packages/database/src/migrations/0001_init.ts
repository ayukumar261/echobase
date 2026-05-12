import type { Kysely } from "kysely";

/**
 * Placeholder initial migration. Exists so the migrator has something to
 * apply before real tables land — this also creates the `kysely_migration`
 * bookkeeping table on first run.
 */

export async function up(_db: Kysely<unknown>): Promise<void> {
  // intentionally empty
}

export async function down(_db: Kysely<unknown>): Promise<void> {
  // intentionally empty
}
