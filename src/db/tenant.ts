import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Every query runs inside a transaction that pins the tenant for Postgres row-level
 * security (`app.org_id`). `withSystem` is reserved for platform-level work such as
 * authentication and super admin screens.
 */
export function makeTenantRunners(db: Database) {
  async function withTenant<T>(organizationId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (!organizationId) throw new Error("Tenant context is required");
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.org_id', ${organizationId}, true), set_config('app.bypass', 'off', true)`,
      );
      return fn(tx);
    });
  }

  async function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.org_id', '', true), set_config('app.bypass', 'on', true)`,
      );
      return fn(tx);
    });
  }

  return { withTenant, withSystem };
}

/**
 * Runs query thunks one after another on the same transaction client.
 * (A pg client cannot execute queries concurrently; Promise.all would queue them implicitly.)
 */
export async function sequential<T extends readonly (() => Promise<unknown>)[]>(
  thunks: T,
): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const out: unknown[] = [];
  for (const t of thunks) out.push(await t());
  return out as { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };
}
