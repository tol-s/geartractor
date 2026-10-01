import { afterAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { getItemOrThrow, assignChild } from "@/server/inventory";
import { NotFoundError } from "@/server/errors";
import { createTenant, inTenant, makeItem, pool, withTenant, db } from "../helpers";

afterAll(() => pool.end());

describe("multi-tenant isolation (database enforced)", () => {
  it("RLS hides other tenants' rows even without a WHERE clause", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const itemA = await makeItem(a, { kind: "component", name: "Helmet A" });
    await makeItem(b, { kind: "component", name: "Helmet B" });
    const visible = await inTenant(a, (tx) => tx.select({ id: schema.inventoryItems.id, org: schema.inventoryItems.organizationId }).from(schema.inventoryItems));
    expect(visible.length).toBeGreaterThan(0);
    expect(visible.every((r) => r.org === a.org.id)).toBe(true);
    expect(visible.some((r) => r.id === itemA.id)).toBe(true);
    const users = await inTenant(a, (tx) => tx.select().from(schema.users));
    expect(users.every((u) => u.organizationId === a.org.id)).toBe(true);
  });

  it("services cannot load another tenant's record", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const itemB = await makeItem(b, { kind: "component" });
    await expect(inTenant(a, (tx) => getItemOrThrow(tx, a.org.id, itemB.id))).rejects.toBeInstanceOf(NotFoundError);
    // Even if the application passed the wrong organization id, RLS still hides the row.
    await expect(inTenant(a, (tx) => getItemOrThrow(tx, b.org.id, itemB.id))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects writes into another tenant", async () => {
    const a = await createTenant();
    const b = await createTenant();
    await expect(
      inTenant(a, (tx) => tx.insert(schema.locations).values({ organizationId: b.org.id, name: "Sneaky" })),
    ).rejects.toThrow();
    const itemB = await makeItem(b, { kind: "component" });
    const updated = await inTenant(a, (tx) =>
      tx.update(schema.inventoryItems).set({ name: "hacked" }).where(eq(schema.inventoryItems.id, itemB.id)).returning(),
    );
    expect(updated).toHaveLength(0);
  });

  it("prevents cross-tenant relationships", async () => {
    const a = await createTenant();
    const b = await createTenant();
    const cfgA = await makeItem(a, { kind: "configuration" });
    const compB = await makeItem(b, { kind: "component" });
    await expect(inTenant(a, (tx) => assignChild(tx, a.admin, cfgA.id, compB.id))).rejects.toThrow();
  });

  it("queries outside a tenant transaction see nothing", async () => {
    await createTenant();
    const rows = await db.execute(sql`select count(*)::int as n from inventory_items`);
    expect(Number((rows.rows[0] as { n: number }).n)).toBe(0);
  });

  it("the runtime role cannot bypass row-level security", async () => {
    const r = await withTenant("00000000-0000-0000-0000-000000000000", (tx) =>
      tx.execute(sql`select rolbypassrls, rolsuper from pg_roles where rolname = current_user`),
    );
    expect(r.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
  });
});
