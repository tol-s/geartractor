import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "./schema";
import { makeTenantRunners } from "./tenant";

declare global {
  var __gtPool: Pool | undefined;
}

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }
  return new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
}

const pool = globalThis.__gtPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalThis.__gtPool = pool;

export const db = drizzle(pool, { schema, casing: "snake_case" });
export const { withTenant, withSystem } = makeTenantRunners(db);
export { sql };
