import { sql } from "drizzle-orm";
import type { Tx } from "@/db/tenant";
import { AppError } from "../errors";

/**
 * Fixed-window rate limiter stored in Postgres so it works across serverless instances.
 * Throws a friendly AppError when the limit is exceeded.
 */
export async function enforceRateLimit(tx: Tx, key: string, limit: number, windowSeconds: number) {
  const result = await tx.execute<{ count: number }>(sql`
    insert into rate_limits (key, count, window_start)
    values (${key}, 1, now())
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then now() else rate_limits.window_start end
    returning count
  `);
  const count = Number(result.rows[0]?.count ?? 0);
  if (count > limit) {
    throw new AppError(
      "Too many attempts",
      "Please wait a few minutes before trying again.",
      "rate_limited",
    );
  }
}
