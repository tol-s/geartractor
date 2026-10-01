import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { makeTenantRunners, type Tx } from "@/db/tenant";
import { permissionsFor } from "@/server/auth/permissions";
import { createInventoryItem } from "@/server/inventory";
import type { InventoryInput } from "@/lib/validators";
import type { Role } from "@/lib/domain";

export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
export const db = drizzle(pool, { schema });
export const { withTenant, withSystem } = makeTenantRunners(db);

let counter = 0;
export const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export type TestCtx = Awaited<ReturnType<typeof createTenant>>;

/** Creates an isolated organization with an admin, a trainer and two locations. */
export async function createTenant(opts: { settings?: schema.OrgSettings } = {}) {
  const id = uid();
  return withSystem(async (tx) => {
    const [org] = await tx
      .insert(schema.organizations)
      .values({ name: `Org ${id}`, slug: `org-${id}`, timezone: "UTC", settings: { allowReservedOverride: true, ...opts.settings } })
      .returning();
    const [admin] = await tx
      .insert(schema.users)
      .values({ organizationId: org.id, email: `admin-${id}@test.dev`, name: "Admin User", role: "org_admin", status: "active" })
      .returning();
    const [trainer] = await tx
      .insert(schema.users)
      .values({ organizationId: org.id, email: `trainer-${id}@test.dev`, name: "Trainer User", role: "trainer", status: "active" })
      .returning();
    const [main] = await tx.insert(schema.locations).values({ organizationId: org.id, name: "Main" }).returning();
    const [yard] = await tx.insert(schema.locations).values({ organizationId: org.id, name: "Yard" }).returning();
    const ctx = (user: typeof admin) => ({
      orgId: org.id,
      org: { ...org, logoDataUrl: null },
      user: { ...user, phone: null },
      can: (p: Parameters<ReturnType<typeof permissionsFor>["has"]>[0]) => permissionsFor(user.role as Role, org.settings).has(p),
    });
    return { org, admin: ctx(admin), trainer: ctx(trainer), locations: { main: main.id, yard: yard.id } };
  });
}

export function inTenant<T>(t: TestCtx, fn: (tx: Tx) => Promise<T>) {
  return withTenant(t.org.id, fn);
}

export async function makeItem(t: TestCtx, input: Partial<InventoryInput> & Pick<InventoryInput, "kind">) {
  return inTenant(t, (tx) =>
    createInventoryItem(tx, t.admin, {
      name: input.name ?? `${input.kind} ${uid()}`,
      locationId: input.locationId ?? t.locations.main,
      lifespanMode: "unlimited",
      annualInspectionRequired: false,
      ...input,
    } as InventoryInput),
  );
}

export async function reload(t: TestCtx, id: string) {
  const { eq } = await import("drizzle-orm");
  return inTenant(t, async (tx) => (await tx.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.id, id)))[0]);
}

export function isoDaysFromNow(days: number) {
  return new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
}
