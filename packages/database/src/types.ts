/**
 * Convenience row-type aliases derived from `./schema.ts`.
 *
 * Pattern: for each table `Foo` on `DB`, export
 *   type FooRow    = Selectable<DB['foo']>
 *   type FooInsert = Insertable<DB['foo']>
 *   type FooUpdate = Updateable<DB['foo']>
 */

import type { Selectable, Insertable, Updateable } from "kysely";
import type { Users } from "./schema.js";

export type {
  Selectable,
  Insertable,
  Updateable,
  ColumnType,
  Generated,
} from "kysely";

export type UserRow = Selectable<Users>;
export type UserInsert = Insertable<Users>;
export type UserUpdate = Updateable<Users>;
