import { sql } from "drizzle-orm";
import type { Tx } from "@/db/tenant";

/** Allocates the next human-readable code for a prefix within an organization (e.g. CPT-000031). */
export async function nextCode(tx: Tx, organizationId: string, prefix: string): Promise<string> {
  const res = await tx.execute<{ value: number }>(sql`
    insert into code_sequences (organization_id, prefix, value)
    values (${organizationId}, ${prefix}, 1)
    on conflict (organization_id, prefix) do update set value = code_sequences.value + 1
    returning value
  `);
  const value = Number(res.rows[0].value);
  return `${prefix}-${String(value).padStart(6, "0")}`;
}
