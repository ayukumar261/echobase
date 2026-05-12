/**
 * Convenience row-type aliases derived from `./schema.ts`.
 *
 * Pattern: for each table `Foo` on `DB`, export
 *   type FooRow    = Selectable<DB['foo']>
 *   type FooInsert = Insertable<DB['foo']>
 *   type FooUpdate = Updateable<DB['foo']>
 *
 * Empty for now — populate alongside schema additions.
 */

export type {
  Selectable,
  Insertable,
  Updateable,
  ColumnType,
  Generated,
} from "kysely";
