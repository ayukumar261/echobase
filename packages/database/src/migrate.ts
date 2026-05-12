/**
 * CLI migrator entrypoint.
 *
 * Usage:
 *   tsx src/migrate.ts up
 *   tsx src/migrate.ts down
 *
 * Reads `DATABASE_URL` from the environment.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { FileMigrationProvider, Migrator } from "kysely";

import { createDb } from "./client.js";

async function main(): Promise<void> {
  const direction = process.argv[2];
  if (direction !== "up" && direction !== "down") {
    console.error("Usage: tsx src/migrate.ts <up|down>");
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const db = createDb(connectionString);
  const migrationFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "migrations",
  );

  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder,
    }),
  });

  const { error, results } =
    direction === "up"
      ? await migrator.migrateToLatest()
      : await migrator.migrateDown();

  for (const result of results ?? []) {
    if (result.status === "Success") {
      console.log(`✓ ${direction} ${result.migrationName}`);
    } else if (result.status === "Error") {
      console.error(`✗ ${direction} ${result.migrationName}`);
    }
  }

  if (error) {
    console.error("Migration failed:", error);
    await db.destroy();
    process.exit(1);
  }

  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
