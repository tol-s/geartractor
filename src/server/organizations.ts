import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/tenant";
import { invitations, locations, organizations, users, type OrgSettings } from "@/db/schema";
import { emailSchema } from "@/lib/validators";
import { isHexColor, slugify } from "@/lib/utils";
import { AppError, NotFoundError } from "./errors";
import { audit } from "./audit";
import { newToken, sha256 } from "./auth/password";
import { appUrl } from "./qr";

const color = z.string().trim().refine(isHexColor, "Use a hex colour like #FF6B1A");
const LOGO_MAX = 300_000;

export const brandingSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  primaryColor: color,
  secondaryColor: color,
  accentColor: color,
  timezone: z
    .string()
    .trim()
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Select a valid timezone"),
  contactName: z.string().trim().max(120).optional().nullable().transform((v) => v || null),
  contactEmail: z
    .string()
    .trim()
    .max(200)
    .optional()
    .nullable()
    .transform((v) => v || null)
    .refine((v) => v === null || z.email().safeParse(v).success, "Enter a valid email"),
  contactPhone: z.string().trim().max(60).optional().nullable().transform((v) => v || null),
  address: z.string().trim().max(300).optional().nullable().transform((v) => v || null),
  logoDataUrl: z
    .string()
    .max(LOGO_MAX, "Logo must be smaller than 200KB")
    .refine((v) => v === "" || /^data:image\/(png|jpeg|svg\+xml|webp);base64,[A-Za-z0-9+/=]+$/.test(v), "Logo must be a PNG, JPG, SVG or WebP image")
    .optional()
    .nullable()
    .transform((v) => (v === undefined ? undefined : v || null)),
});

export const settingsSchema = z.object({
  trainersCanInspect: z.boolean().default(false),
  allowReservedOverride: z.boolean().default(false),
  defaultCheckoutDays: z.coerce.number().int().min(1).max(365).default(7),
});

export const createOrgSchema = brandingSchema.extend({
  slug: z.string().trim().max(48).optional().nullable(),
  adminName: z.string().trim().min(1, "Admin name is required").max(120),
  adminEmail: emailSchema,
});

export async function listOrganizations(tx: Tx) {
  return tx
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      status: organizations.status,
      primaryColor: organizations.primaryColor,
      logoDataUrl: organizations.logoDataUrl,
      createdAt: organizations.createdAt,
      userCount: sql<number>`(select count(*)::int from users u where u.organization_id = ${organizations.id})`,
      inventoryCount: sql<number>`(select count(*)::int from inventory_items i where i.organization_id = ${organizations.id} and i.archived_at is null)`,
      activeCheckouts: sql<number>`(select count(*)::int from checkouts c where c.organization_id = ${organizations.id} and c.status in ('active','partially_returned'))`,
    })
    .from(organizations)
    .orderBy(asc(organizations.name));
}

export async function platformStats(tx: Tx) {
  const res = await tx.execute<{ orgs: number; active_orgs: number; users: number; inventory: number }>(sql`
    select
      (select count(*)::int from organizations) as orgs,
      (select count(*)::int from organizations where status = 'active') as active_orgs,
      (select count(*)::int from users where organization_id is not null and status <> 'deactivated') as users,
      (select count(*)::int from inventory_items where archived_at is null) as inventory
  `);
  const r = res.rows[0];
  return {
    totalOrganizations: Number(r.orgs),
    activeOrganizations: Number(r.active_orgs),
    totalUsers: Number(r.users),
    totalInventory: Number(r.inventory),
  };
}

export async function getOrganization(tx: Tx, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError("organization");
  const [org] = await tx.select().from(organizations).where(eq(organizations.id, id));
  if (!org) throw new NotFoundError("organization");
  return org;
}

export async function createOrganization(tx: Tx, actorId: string, raw: unknown) {
  const v = createOrgSchema.parse(raw);
  const slug = slugify(v.slug || v.name);
  if (!slug) throw new AppError("Invalid slug", "Enter a name with letters or numbers.", "validation");
  const [org] = await tx
    .insert(organizations)
    .values({
      name: v.name,
      slug,
      primaryColor: v.primaryColor,
      secondaryColor: v.secondaryColor,
      accentColor: v.accentColor,
      timezone: v.timezone,
      contactName: v.contactName,
      contactEmail: v.contactEmail,
      contactPhone: v.contactPhone,
      address: v.address,
      logoDataUrl: v.logoDataUrl ?? null,
      settings: { trainersCanInspect: false, allowReservedOverride: false, defaultCheckoutDays: 7 },
    })
    .returning();
  await tx.insert(locations).values({ organizationId: org.id, name: "Main Warehouse", code: "MAIN" });
  const [admin] = await tx
    .insert(users)
    .values({ organizationId: org.id, email: v.adminEmail, name: v.adminName, role: "org_admin", status: "invited" })
    .returning();
  const token = newToken();
  await tx.insert(invitations).values({
    organizationId: org.id,
    userId: admin.id,
    email: v.adminEmail,
    role: "org_admin",
    tokenHash: sha256(token),
    invitedBy: actorId,
    expiresAt: new Date(Date.now() + 7 * 86400_000),
  });
  await audit(tx, {
    organizationId: org.id,
    actorId,
    action: "organization_change",
    entityType: "organization",
    entityId: org.id,
    entityLabel: org.name,
    next: { created: true, admin: v.adminEmail },
  });
  return { org, inviteUrl: `${appUrl()}/invite/${token}`, adminEmail: v.adminEmail };
}

export async function updateOrganizationBranding(tx: Tx, actorId: string, orgId: string, raw: unknown) {
  const existing = await getOrganization(tx, orgId);
  const v = brandingSchema.parse(raw);
  const patch: Partial<typeof organizations.$inferInsert> = {
    name: v.name,
    primaryColor: v.primaryColor,
    secondaryColor: v.secondaryColor,
    accentColor: v.accentColor,
    timezone: v.timezone,
    contactName: v.contactName,
    contactEmail: v.contactEmail,
    contactPhone: v.contactPhone,
    address: v.address,
    updatedAt: new Date(),
  };
  if (v.logoDataUrl !== undefined) patch.logoDataUrl = v.logoDataUrl;
  if (v.timezone !== existing.timezone) patch.statusRecomputedOn = null;
  await tx.update(organizations).set(patch).where(eq(organizations.id, orgId));
  await audit(tx, {
    organizationId: orgId,
    actorId,
    action: "organization_change",
    entityType: "organization",
    entityId: orgId,
    entityLabel: v.name,
    previous: {
      name: existing.name,
      primaryColor: existing.primaryColor,
      secondaryColor: existing.secondaryColor,
      accentColor: existing.accentColor,
      timezone: existing.timezone,
    },
    next: { name: v.name, primaryColor: v.primaryColor, secondaryColor: v.secondaryColor, accentColor: v.accentColor, timezone: v.timezone, logoChanged: v.logoDataUrl !== undefined },
  });
}

export async function updateOrganizationSettings(tx: Tx, actorId: string, orgId: string, raw: unknown) {
  const existing = await getOrganization(tx, orgId);
  const v: OrgSettings = settingsSchema.parse(raw);
  await tx.update(organizations).set({ settings: v, updatedAt: new Date() }).where(eq(organizations.id, orgId));
  await audit(tx, {
    organizationId: orgId,
    actorId,
    action: "organization_change",
    entityType: "organization",
    entityId: orgId,
    entityLabel: existing.name,
    previous: existing.settings,
    next: v,
  });
}

export async function setOrganizationStatus(tx: Tx, actorId: string, orgId: string, status: "active" | "inactive") {
  const existing = await getOrganization(tx, orgId);
  if (existing.status === status) return;
  await tx.update(organizations).set({ status, updatedAt: new Date() }).where(eq(organizations.id, orgId));
  if (status === "inactive") {
    // Sign out every member of a deactivated organization.
    await tx.execute(sql`delete from sessions where user_id in (select id from users where organization_id = ${orgId})`);
  }
  await audit(tx, {
    organizationId: orgId,
    actorId,
    action: "organization_change",
    entityType: "organization",
    entityId: orgId,
    entityLabel: existing.name,
    previous: { status: existing.status },
    next: { status },
  });
}

export async function listSuperAdmins(tx: Tx) {
  return tx
    .select({ id: users.id, name: users.name, email: users.email, lastActiveAt: users.lastActiveAt, status: users.status })
    .from(users)
    .where(eq(users.role, "super_admin"))
    .orderBy(asc(users.name));
}
