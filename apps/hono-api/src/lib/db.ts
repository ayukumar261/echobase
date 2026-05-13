import { createDb, type Db } from '@repo/database'

let cached: Db | undefined

/**
 * Lazily build a single Kysely client for the process. Routes import this
 * rather than instantiating their own pool so we don't leak connections on
 * hot reload.
 */
export function getDb(): Db {
  if (cached) return cached
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set')
  }
  cached = createDb(connectionString)
  return cached
}
