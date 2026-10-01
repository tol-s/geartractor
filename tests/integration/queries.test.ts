import { afterAll, describe, expect, it } from "vitest";
import { listOrganizations } from "@/server/organizations";
import { listInventory } from "@/server/inventory";
import { listUsers, inviteUser } from "@/server/users";
import { createTenant, inTenant, makeItem, pool, uid, withSystem } from "../helpers";

afterAll(() => pool.end());

/** Regression: correlated subqueries must bind to the outer table even in join-free queries. */
describe("aggregate queries", () => {
  it("counts users and inventory per organization", async () => {
    const t = await createTenant();
    await makeItem(t, { kind: "component" });
    await makeItem(t, { kind: "component" });
    const orgs = await withSystem((tx) => listOrganizations(tx));
    const row = orgs.find((o) => o.id === t.org.id)!;
    expect(row.userCount).toBe(2);
    expect(row.inventoryCount).toBe(2);
  });

  it("filtered totals match the rows returned", async () => {
    const t = await createTenant();
    await makeItem(t, { kind: "component", name: "Tagged one", tags: ["Special"] });
    await makeItem(t, { kind: "component", name: "Plain" });
    const byTag = await inTenant(t, (tx) => listInventory(tx, t.org.id, { tag: "Special" }));
    expect(byTag.total).toBe(1);
    expect(byTag.rows).toHaveLength(1);
    const unassigned = await inTenant(t, (tx) => listInventory(tx, t.org.id, { availability: "unassigned" }));
    expect(unassigned.total).toBe(2);
  });

  it("shows pending invitation expiry", async () => {
    const t = await createTenant();
    await inTenant(t, (tx) => inviteUser(tx, t.admin, { name: "Pending", email: `p-${uid()}@t.dev`, role: "trainer" }));
    const users = await inTenant(t, (tx) => listUsers(tx, t.org.id));
    expect(users.find((u) => u.name === "Pending")?.inviteExpiresAt).not.toBeNull();
    expect(users.find((u) => u.name === "Admin User")?.inviteExpiresAt).toBeNull();
  });
});
