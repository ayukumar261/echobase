/**
 * Source of truth for database table shapes.
 *
 * Each table is declared as an interface, then registered on the root `DB`
 * interface. Kysely uses `DB` to type queries end-to-end, and we derive
 * row/insert/update aliases from these interfaces in `./types.ts`.
 *
 * Add new tables here; pair every change with a migration in `./migrations`.
 */

// Tables will be added here as features land. The `DB` interface is
// intentionally empty for now so the package compiles and the migrator runs.
export interface DB {}
