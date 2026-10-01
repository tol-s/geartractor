import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import { makeTenantRunners, type Tx } from "../src/db/tenant";
import { hashPassword } from "../src/server/auth/password";
import { permissionsFor } from "../src/server/auth/permissions";
import { addKitContent, allocateConsumable, assignChild, createInventoryItem, setItemStatus } from "../src/server/inventory";
import { addToBasket, confirmCheckout, createDraftCheckout, processReturn, updateDraftDetails, type ReturnLineInput } from "../src/server/checkout";
import { cancelReservation, createReservation } from "../src/server/reservations";
import { recordInspection } from "../src/server/inspections";
import { completeAttachment, initAttachment, putAttachmentChunk } from "../src/server/attachments";
import { recomputeOrgStatuses } from "../src/server/status-engine";
import { isoDateInZone } from "../src/lib/utils";
import type { InventoryInput } from "../src/lib/validators";
import type { QuantityUnit } from "../src/lib/domain";

/**
 * Rich demo data so every page and every role has plenty to show.
 * Runs once (guarded by a marker user) and is purely additive: it never deletes data.
 * Everything is created through the real domain services and then back-dated, so
 * codes, stock ledgers, statuses, QR tokens and audit history are all consistent.
 *
 * Usage: pnpm db:seed:bulk   (after pnpm db:seed)
 */

const MARKER_EMAIL = "priya@geartractor.app";
const ASSETS = path.join(process.cwd(), "scripts", "seed-assets");

/* ------------------------------------------------------------------ */
/* Deterministic randomness                                            */
/* ------------------------------------------------------------------ */

let seedState = 20261001;
function rand() {
  seedState |= 0;
  seedState = (seedState + 0x6d2b79f5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
const chance = (p: number) => rand() < p;

const DAY = 86400_000;
const daysAgo = (d: number, hour = 9) => {
  const t = new Date(Date.now() - d * DAY);
  t.setUTCHours(hour + 6, int(0, 59), 0, 0);
  // Never in the future: events "today" happened earlier today.
  if (t.getTime() > Date.now() - 15 * 60_000) return new Date(Date.now() - int(20, 240) * 60_000);
  return t;
};
const isoDaysAgo = (d: number) => new Date(Date.now() - d * DAY).toISOString().slice(0, 10);
const isoMonthsAgo = (m: number) => {
  const t = new Date();
  t.setUTCMonth(t.getUTCMonth() - m);
  return t.toISOString().slice(0, 10);
};

/* ------------------------------------------------------------------ */
/* Organization specs                                                  */
/* ------------------------------------------------------------------ */

type Lifespan = "finite-mfg" | "finite-first" | "explicit" | "unlimited";
type ComponentTpl = { name: string; spec: string; mfr: string; count: number; life: Lifespan; months?: number; insp: boolean; tags: string[]; photo?: string };
type ConsumableTpl = { name: string; spec: string; mfr: string; unit: QuantityUnit; qty: number; threshold: number; tags: string[]; expiryMonths?: number };
type Recipe = { name: string; count: number; purpose: string; parts: [string, number][]; consumables?: [string, number][] };
type KitRecipe = { name: string; count: number; purpose: string; configs: string[]; parts: [string, number][]; consumables?: [string, number][]; contents: [string, string][]; nested?: string };
type UserSpec = { name: string; email: string; role: "org_admin" | "trainer"; status?: "active" | "invited" | "deactivated" };

type OrgSpec = {
  slug: string;
  create?: { name: string; primary: string; secondary: string; accent: string; timezone: string; contactEmail: string; inactive?: boolean };
  locations: [string, string, string][];
  /** Locations that get most of the inventory (assemblies are built there). */
  hubs: string[];
  users: UserSpec[];
  components: ComponentTpl[];
  consumables: ConsumableTpl[];
  configs: Recipe[];
  kits: KitRecipe[];
  events: string[];
  history: number;
  reservations: string[];
};

const GEAR_TRACTOR: OrgSpec = {
  slug: "gear-tractor",
  locations: [
    ["Calgary Depot", "CDP", "City depot for corporate and event work"],
    ["Edmonton Depot", "EDP", "Northern operations depot"],
    ["Banff Field Base", "BFB", "Mountain field base for climbing courses"],
  ],
  hubs: ["Main Warehouse", "Calgary Depot", "Training Yard", "Workshop", "Banff Field Base", "Edmonton Depot"],
  users: [
    { name: "Priya Nair", email: MARKER_EMAIL, role: "org_admin" },
    { name: "Liam O'Connor", email: "liam@geartractor.app", role: "trainer" },
    { name: "Aisha Khan", email: "aisha@geartractor.app", role: "trainer" },
    { name: "Noah Williams", email: "noah@geartractor.app", role: "trainer" },
    { name: "Chloe Martin", email: "chloe@geartractor.app", role: "trainer" },
    { name: "Ethan Brooks", email: "ethan@geartractor.app", role: "trainer" },
    { name: "Zara Ahmed", email: "zara@geartractor.app", role: "trainer" },
    { name: "Owen Fraser", email: "owen@geartractor.app", role: "trainer", status: "invited" },
    { name: "Grace Lee", email: "grace@geartractor.app", role: "trainer", status: "deactivated" },
  ],
  components: [
    { name: "Helmet", spec: "Petzl Strato Vent, EN 397 / EN 12492", mfr: "Petzl", count: 18, life: "finite-mfg", months: 120, insp: true, tags: ["PPE", "Head protection"], photo: "helmet" },
    { name: "Harness", spec: "Petzl Sequoia SRT, EN 813 / EN 358", mfr: "Petzl", count: 14, life: "finite-mfg", months: 120, insp: true, tags: ["PPE", "Fall protection"], photo: "harness" },
    { name: "Rope", spec: "Beal Contract 10.5mm, 60m, EN 1891 A", mfr: "Beal", count: 14, life: "finite-first", months: 120, insp: true, tags: ["Rope", "Fall protection"], photo: "rope" },
    { name: "Carabiner", spec: "DMM Ultra O Locksafe, 25kN", mfr: "DMM", count: 36, life: "unlimited", insp: true, tags: ["Connector", "Fall protection"] },
    { name: "Descender", spec: "Petzl Rig, EN 12841 C", mfr: "Petzl", count: 8, life: "unlimited", insp: true, tags: ["Descender", "Rope access"] },
    { name: "Fall Arrester", spec: "Petzl ASAP Lock, EN 12841 A", mfr: "Petzl", count: 8, life: "unlimited", insp: true, tags: ["Rope access"] },
    { name: "Chainsaw", spec: "Husqvarna 550 XP Mark II, 15in bar", mfr: "Husqvarna", count: 10, life: "unlimited", insp: true, tags: ["Chainsaw", "Powered"], photo: "chainsaw" },
    { name: "Chainsaw Chaps", spec: "Stihl Function Universal, Class 1", mfr: "Stihl", count: 10, life: "finite-mfg", months: 60, insp: true, tags: ["PPE", "Safety Equipment"] },
    { name: "Ear Defenders", spec: "3M Peltor Optime III, SNR 35dB", mfr: "3M", count: 10, life: "explicit", months: 36, insp: false, tags: ["PPE", "Safety Equipment"] },
    { name: "Pulley", spec: "Petzl Partner, 8kN", mfr: "Petzl", count: 8, life: "unlimited", insp: true, tags: ["Rigging"] },
    { name: "Sling", spec: "Petzl Anneau 120cm, 22kN", mfr: "Petzl", count: 12, life: "finite-mfg", months: 120, insp: true, tags: ["Rigging", "Fall protection"] },
    { name: "Throw Line Kit", spec: "Notch 2.2mm throw line + cube", mfr: "Notch", count: 6, life: "unlimited", insp: false, tags: ["Climbing"] },
    { name: "Radio", spec: "Motorola DP1400 UHF handheld", mfr: "Motorola", count: 10, life: "unlimited", insp: false, tags: ["Comms"] },
    { name: "Stretcher", spec: "Ferno Scoop EXL", mfr: "Ferno", count: 4, life: "unlimited", insp: true, tags: ["Rescue", "Medical"] },
    { name: "Lanyard", spec: "Petzl Progress Adjust-Y", mfr: "Petzl", count: 6, life: "finite-first", months: 120, insp: true, tags: ["Fall protection"] },
  ],
  consumables: [
    { name: "Fuel (2-stroke mix)", spec: "Aspen 2T alkylate, 50:1", mfr: "Aspen", unit: "litres", qty: 60, threshold: 12, tags: ["Fuel"], expiryMonths: 18 },
    { name: "Bar & Chain Oil", spec: "Husqvarna X-Guard", mfr: "Husqvarna", unit: "litres", qty: 30, threshold: 8, tags: ["Oil"] },
    { name: "Nitrile Gloves", spec: "Box of 100, size L", mfr: "Ansell", unit: "units", qty: 40, threshold: 10, tags: ["PPE"] },
    { name: "Accessory Cord", spec: "7mm accessory cord", mfr: "Sterling", unit: "metres", qty: 300, threshold: 60, tags: ["Rope"] },
    { name: "Chain Files", spec: "Oregon 4.8mm round file", mfr: "Oregon", unit: "units", qty: 24, threshold: 6, tags: ["Maintenance"] },
    { name: "AA Batteries", spec: "Duracell Procell AA", mfr: "Duracell", unit: "units", qty: 120, threshold: 30, tags: ["Comms"] },
    { name: "Hand Sanitiser", spec: "70% alcohol gel", mfr: "Purell", unit: "litres", qty: 10, threshold: 3, tags: ["Hygiene"], expiryMonths: 24 },
    { name: "Zip Ties", spec: "300mm heavy duty", mfr: "Hellermann", unit: "units", qty: 500, threshold: 100, tags: ["Maintenance"] },
  ],
  configs: [
    { name: "Chainsaw Setup", count: 6, purpose: "Felling and crosscutting", parts: [["Chainsaw", 1], ["Chainsaw Chaps", 1], ["Helmet", 1], ["Ear Defenders", 1]], consumables: [["Fuel (2-stroke mix)", 4], ["Bar & Chain Oil", 1]] },
    { name: "Rope Access Setup", count: 5, purpose: "Two-rope working system", parts: [["Harness", 1], ["Descender", 1], ["Fall Arrester", 1], ["Carabiner", 3], ["Rope", 1]] },
    { name: "Climbing Setup", count: 4, purpose: "Tree climbing (SRT)", parts: [["Harness", 1], ["Helmet", 1], ["Carabiner", 3], ["Rope", 1], ["Pulley", 1]], consumables: [["Accessory Cord", 10]] },
    { name: "Rescue Setup", count: 2, purpose: "Rescue from height", parts: [["Stretcher", 1], ["Sling", 2], ["Pulley", 1], ["Carabiner", 4]], consumables: [["Nitrile Gloves", 2]] },
  ],
  kits: [
    { name: "Arborist Kit", count: 2, purpose: "Complete arborist course kit", configs: ["Chainsaw Setup", "Climbing Setup"], parts: [["Radio", 1], ["Throw Line Kit", 1]], consumables: [["Chain Files", 2]], contents: [["Laminated tree risk card", "2"], ["Wedges and felling lever", "1 set"]] },
    { name: "Rope Access Kit", count: 2, purpose: "IRATA-style rope access", configs: ["Rope Access Setup", "Rope Access Setup"], parts: [["Radio", 2], ["Sling", 1]], contents: [["Rope protectors", "4"], ["Rescue plan template", "1"]] },
    { name: "Rescue Kit", count: 1, purpose: "Rescue response", configs: ["Rescue Setup"], parts: [["Radio", 1]], consumables: [["Hand Sanitiser", 1]], contents: [["Emergency blankets", "4"], ["Casualty card", "10"]] },
    { name: "Expedition Kit", count: 1, purpose: "Multi-day field expedition", configs: ["Chainsaw Setup"], parts: [["Radio", 2]], consumables: [["AA Batteries", 12]], contents: [["Satellite messenger", "1"]], nested: "Rescue Kit" },
  ],
  events: [
    "Chainsaw Safety Level 2",
    "Tree Climbing Course",
    "Rope Rescue Refresher",
    "Corporate Team Day – Shell",
    "Storm Response – Canmore",
    "Utility Line Clearance",
    "IRATA Assessment Prep",
    "School Outreach – Banff",
    "Festival Rigging – Calgary Stampede",
    "Arborist Apprenticeship Week",
    "Emergency Services Joint Drill",
    "Park Maintenance – Edmonton",
  ],
  history: 46,
  reservations: ["Spring Climbing Camp", "Corporate Gala – Suncor", "Rescue Drill – Fire Dept", "Apprentice Intake Day", "Wildfire Prep Workshop", "Bow Valley Trail Work", "Film Shoot Rigging", "Hydro Line Survey"],
};

const TEGNOL: OrgSpec = {
  slug: "tegnol",
  locations: [
    ["Lahore Studio", "LHE", "Second production studio"],
    ["Field Van", "VAN", "Mobile production van"],
  ],
  hubs: ["Karachi Studio", "Equipment Room", "Lahore Studio", "Field Van"],
  users: [
    { name: "Hira Malik", email: "hira@tegnol.agency", role: "org_admin" },
    { name: "Bilal Ahmed", email: "bilal@tegnol.agency", role: "trainer" },
    { name: "Sana Tariq", email: "sana@tegnol.agency", role: "trainer" },
    { name: "Usman Raza", email: "usman@tegnol.agency", role: "trainer" },
    { name: "Ayesha Siddiqui", email: "ayesha@tegnol.agency", role: "trainer", status: "invited" },
  ],
  components: [
    { name: "Camera Body", spec: "Sony FX6 Cinema Line", mfr: "Sony", count: 6, life: "unlimited", insp: true, tags: ["Video"], photo: "camera" },
    { name: "Lens", spec: "Sony FE 24-70mm f/2.8 GM II", mfr: "Sony", count: 10, life: "unlimited", insp: false, tags: ["Video", "Optics"] },
    { name: "Tripod", spec: "Sachtler Flowtech 75", mfr: "Sachtler", count: 8, life: "unlimited", insp: true, tags: ["Support"] },
    { name: "Gimbal", spec: "DJI RS 4 Pro", mfr: "DJI", count: 5, life: "unlimited", insp: true, tags: ["Support"] },
    { name: "LED Panel", spec: "Aputure Amaran 200x S", mfr: "Aputure", count: 12, life: "unlimited", insp: true, tags: ["Lighting"] },
    { name: "Light Stand", spec: "Manfrotto 1004BAC", mfr: "Manfrotto", count: 12, life: "unlimited", insp: false, tags: ["Lighting", "Support"] },
    { name: "Wireless Mic", spec: "Rode Wireless PRO", mfr: "Rode", count: 10, life: "unlimited", insp: false, tags: ["Audio"] },
    { name: "Audio Recorder", spec: "Zoom F6", mfr: "Zoom", count: 4, life: "unlimited", insp: true, tags: ["Audio"] },
    { name: "Monitor", spec: "Atomos Ninja V+", mfr: "Atomos", count: 6, life: "unlimited", insp: false, tags: ["Video"] },
    { name: "V-Mount Battery", spec: "Core SWX Hypercore 98", mfr: "Core SWX", count: 16, life: "finite-first", months: 48, insp: true, tags: ["Power"] },
  ],
  consumables: [
    { name: "Gaffer Tape", spec: "Pro Gaff 48mm", mfr: "ProTapes", unit: "units", qty: 40, threshold: 10, tags: ["Grip"] },
    { name: "SD Cards", spec: "SanDisk Extreme Pro 128GB", mfr: "SanDisk", unit: "units", qty: 30, threshold: 8, tags: ["Media"] },
    { name: "Lens Wipes", spec: "Zeiss lens wipes", mfr: "Zeiss", unit: "units", qty: 200, threshold: 40, tags: ["Cleaning"] },
    { name: "Diffusion Gel", spec: "Lee 216 White Diffusion", mfr: "Lee Filters", unit: "metres", qty: 25, threshold: 5, tags: ["Lighting"] },
  ],
  configs: [
    { name: "Shoot Rig", count: 4, purpose: "Single camera interview rig", parts: [["Camera Body", 1], ["Lens", 1], ["Tripod", 1], ["Monitor", 1], ["V-Mount Battery", 2]], consumables: [["SD Cards", 2]] },
    { name: "Lighting Setup", count: 4, purpose: "Two-point lighting", parts: [["LED Panel", 2], ["Light Stand", 2]], consumables: [["Diffusion Gel", 2]] },
    { name: "Audio Setup", count: 3, purpose: "Dual wireless + recorder", parts: [["Wireless Mic", 2], ["Audio Recorder", 1]] },
  ],
  kits: [
    { name: "Interview Kit", count: 2, purpose: "Corporate interview package", configs: ["Shoot Rig", "Lighting Setup", "Audio Setup"], parts: [], consumables: [["Gaffer Tape", 2]], contents: [["Clapperboard", "1"], ["Release forms", "20"]] },
    { name: "Documentary Kit", count: 1, purpose: "Run-and-gun documentary", configs: ["Shoot Rig", "Audio Setup"], parts: [["Gimbal", 1]], consumables: [["Lens Wipes", 10]], contents: [["Rain covers", "2"]] },
  ],
  events: ["Brand Film – Daraz", "Podcast Season 3", "Wedding Highlight Shoot", "Product Launch – K-Electric", "Documentary – Thar Desert", "Corporate Interviews – HBL", "Music Video – Lahore"],
  history: 22,
  reservations: ["TV Commercial – Jazz", "Conference Coverage", "Fashion Week Backstage", "Startup Pitch Day"],
};

const SUMMIT: OrgSpec = {
  slug: "summit-arborists",
  create: { name: "Summit Arborists", primary: "#0E9F6E", secondary: "#0EA5E9", accent: "#F59E0B", timezone: "America/Vancouver", contactEmail: "office@summitarborists.ca" },
  locations: [
    ["North Shore Yard", "NSY", "Main yard and workshop"],
    ["Whistler Base", "WHB", "Seasonal base"],
  ],
  hubs: ["North Shore Yard", "Whistler Base"],
  users: [
    { name: "Marcus Hale", email: "marcus@summitarborists.ca", role: "org_admin" },
    { name: "Elena Petrova", email: "elena@summitarborists.ca", role: "trainer" },
    { name: "Ravi Sandhu", email: "ravi@summitarborists.ca", role: "trainer" },
  ],
  components: GEAR_TRACTOR.components.filter((c) => ["Helmet", "Harness", "Rope", "Carabiner", "Chainsaw", "Chainsaw Chaps", "Ear Defenders", "Pulley"].includes(c.name)).map((c) => ({ ...c, count: Math.ceil(c.count / 2) })),
  consumables: GEAR_TRACTOR.consumables.slice(0, 4),
  configs: [GEAR_TRACTOR.configs[0], { ...GEAR_TRACTOR.configs[2], count: 2 }].map((r) => ({ ...r, count: Math.min(r.count, 3) })),
  kits: [{ name: "Crew Kit", count: 1, purpose: "Daily crew kit", configs: ["Chainsaw Setup"], parts: [["Pulley", 1]], contents: [["Traffic cones", "6"]] }],
  events: ["Hazard Tree Removal", "Hedge Contract – Lonsdale", "Crown Reduction – Stanley Park", "Storm Cleanup"],
  history: 14,
  reservations: ["Municipal Contract Week", "Ski Resort Clearance"],
};

const NORTHWIND: OrgSpec = {
  slug: "northwind-rescue",
  create: { name: "Northwind Rescue", primary: "#DC2626", secondary: "#1D4ED8", accent: "#0891B2", timezone: "Europe/London", contactEmail: "ops@northwindrescue.co.uk", inactive: true },
  locations: [["Inverness Station", "INV", "Primary station"]],
  hubs: ["Inverness Station"],
  users: [{ name: "Fiona MacLeod", email: "fiona@northwindrescue.co.uk", role: "org_admin" }],
  components: GEAR_TRACTOR.components.filter((c) => ["Stretcher", "Rope", "Carabiner", "Radio"].includes(c.name)).map((c) => ({ ...c, count: 3 })),
  consumables: [GEAR_TRACTOR.consumables[2]],
  configs: [],
  kits: [],
  events: ["Mountain Rescue Callout"],
  history: 3,
  reservations: [],
};

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

type Ctx = ReturnType<typeof ctxFor>;
type OrgRow = typeof schema.organizations.$inferSelect;
type UserRow = typeof schema.users.$inferSelect;

function ctxFor(org: OrgRow, user: UserRow) {
  return {
    orgId: org.id,
    org: { id: org.id, name: org.name, slug: org.slug, logoDataUrl: null, primaryColor: org.primaryColor, secondaryColor: org.secondaryColor, accentColor: org.accentColor, timezone: org.timezone, settings: org.settings },
    user: { id: user.id, name: user.name, email: user.email, role: user.role, organizationId: user.organizationId, phone: null, notifyEmail: true, notifyOverdue: true, notifyInspections: true },
    can: (p: Parameters<ReturnType<typeof permissionsFor>["has"]>[0]) => permissionsFor(user.role, org.settings).has(p),
  };
}

/** Moves every row created in the current transaction (created_at = now()) to `when`. */
async function backdate(tx: Tx, when: Date) {
  const w = when.toISOString();
  const cols: [string, string][] = [
    ["audit_logs", "created_at"],
    ["status_history", "created_at"],
    ["consumable_movements", "created_at"],
    ["inspections", "created_at"],
    ["inspection_records", "created_at"],
    ["checkout_items", "created_at"],
    ["qr_codes", "created_at"],
    ["kit_contents", "created_at"],
    ["consumable_allocations", "created_at"],
    ["assignments", "assigned_at"],
    ["attachments", "created_at"],
    ["inventory_items", "created_at"],
    ["inventory_items", "updated_at"],
    ["reservations", "created_at"],
    ["reservations", "updated_at"],
    ["checkouts", "created_at"],
    ["checkouts", "updated_at"],
  ];
  for (const [table, col] of cols) {
    await tx.execute(sql.raw(`update ${table} set ${col} = '${w}'::timestamptz where ${col} = now()`));
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!url || !password) throw new Error("DATABASE_URL and SEED_DEMO_PASSWORD are required");
  const pool = new Pool({ connectionString: url, max: 2 });
  const db = drizzle(pool, { schema });
  const { withSystem, withTenant } = makeTenantRunners(db);

  const already = await withSystem((tx) => tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, MARKER_EMAIL)));
  if (already.length) {
    console.log("Bulk demo data already present; skipping.");
    await pool.end();
    return;
  }
  const base = await withSystem((tx) => tx.select().from(schema.organizations).where(eq(schema.organizations.slug, "gear-tractor")));
  if (!base.length) throw new Error("Run the base seed (pnpm db:seed) first.");

  const hash = await hashPassword(password);
  const started = Date.now();

  for (const spec of [GEAR_TRACTOR, TEGNOL, SUMMIT, NORTHWIND]) {
    await populate(spec);
    console.log(`  ${spec.slug} done (${Math.round((Date.now() - started) / 1000)}s)`);
  }
  await pool.end();
  console.log("Bulk demo data complete");

  async function populate(spec: OrgSpec) {
    /* ---------- organization & users ---------- */
    let org: OrgRow;
    if (spec.create) {
      const c = spec.create;
      [org] = await withSystem((tx) =>
        tx
          .insert(schema.organizations)
          .values({
            name: c.name,
            slug: spec.slug,
            primaryColor: c.primary,
            secondaryColor: c.secondary,
            accentColor: c.accent,
            timezone: c.timezone,
            contactEmail: c.contactEmail,
            settings: { trainersCanInspect: false, allowReservedOverride: true, defaultCheckoutDays: 5 },
            createdAt: daysAgo(220),
          })
          .returning(),
      );
    } else {
      [org] = await withSystem((tx) => tx.select().from(schema.organizations).where(eq(schema.organizations.slug, spec.slug)));
    }
    await withSystem(async (tx) => {
      for (const u of spec.users) {
        await tx
          .insert(schema.users)
          .values({
            organizationId: org.id,
            email: u.email,
            name: u.name,
            role: u.role,
            status: u.status ?? "active",
            passwordHash: u.status === "invited" ? null : hash,
            lastActiveAt: u.status === "active" || !u.status ? new Date(Date.now() - int(10, 4000) * 60_000) : null,
            deactivatedAt: u.status === "deactivated" ? daysAgo(30) : null,
            createdAt: daysAgo(int(120, 210)),
          })
          .onConflictDoNothing();
      }
      // Existing members look recently active too.
      await tx.execute(sql`update users set last_active_at = now() - (random() * interval '2 days') where organization_id = ${org.id} and status = 'active' and last_active_at is null`);
    });
    const members = await withSystem((tx) => tx.select().from(schema.users).where(eq(schema.users.organizationId, org.id)));
    const active = members.filter((m) => m.status === "active");
    const admins = active.filter((m) => m.role === "org_admin");
    const trainers = active.filter((m) => m.role === "trainer");
    const admin = ctxFor(org, admins[0]);
    const anyone = () => ctxFor(org, pick(active));
    const T = <R,>(fn: (tx: Tx) => Promise<R>) => withTenant(org.id, fn);
    const at = <R,>(when: Date, fn: (tx: Tx) => Promise<R>) =>
      T(async (tx) => {
        const r = await fn(tx);
        await backdate(tx, when);
        return r;
      });

    /* ---------- locations ---------- */
    await T(async (tx) => {
      for (const [name, code, description] of spec.locations) {
        await tx.insert(schema.locations).values({ organizationId: org.id, name, code, description, createdAt: daysAgo(200) }).onConflictDoNothing();
      }
    });
    const locs = await T((tx) => tx.select().from(schema.locations).where(eq(schema.locations.organizationId, org.id)));
    const locId = (name: string) => locs.find((l) => l.name === name)?.id;
    const hubs = spec.hubs.map(locId).filter((x): x is string => Boolean(x));
    const weights = hubs.map((_, i) => Math.max(1, hubs.length - i) ** 1.4);
    const weightedHub = () => {
      const total = weights.reduce((a, b) => a + b, 0);
      let r = rand() * total;
      for (let i = 0; i < hubs.length; i++) {
        r -= weights[i];
        if (r <= 0) return hubs[i];
      }
      return hubs[0];
    };

    /* ---------- consumables (per hub) ---------- */
    for (const hub of hubs.slice(0, Math.min(hubs.length, 3))) {
      for (const c of spec.consumables) {
        const low = chance(0.18);
        await at(daysAgo(int(190, 205)), (tx) =>
          createInventoryItem(tx, admin, {
            kind: "consumable",
            name: c.name,
            techSpec: c.spec,
            manufacturer: c.mfr,
            locationId: hub,
            quantityUnit: c.unit,
            initialQuantity: low ? Math.max(1, Math.round(c.threshold * 0.6)) : Math.round(c.qty * (0.7 + rand() * 0.6)),
            reorderThreshold: c.threshold,
            lifespanMode: c.expiryMonths ? "explicit" : "unlimited",
            explicitExpiry: c.expiryMonths ? isoMonthsAgo(-c.expiryMonths + int(0, 6)) : null,
            annualInspectionRequired: false,
            tags: ["Consumable", ...c.tags],
          } as InventoryInput),
        );
      }
    }

    /* ---------- components ---------- */
    const created: { id: string; tpl: ComponentTpl }[] = [];
    for (const tpl of spec.components) {
      const [{ n }] = await T((tx) =>
        tx
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.inventoryItems)
          .where(and(eq(schema.inventoryItems.organizationId, org.id), sql`${schema.inventoryItems.name} ~ ${`^${tpl.name} [0-9]+$`}`)),
      );
      for (let i = 1; i <= tpl.count; i++) {
        const mfgMonths = int(4, 70);
        const input: Partial<InventoryInput> = {
          kind: "component",
          name: `${tpl.name} ${Number(n) + i}`,
          techSpec: tpl.spec,
          manufacturer: tpl.mfr,
          serialNumber: `${tpl.mfr.slice(0, 3).toUpperCase()}-${int(10000, 99999)}`,
          locationId: weightedHub(),
          manufactureDate: isoMonthsAgo(mfgMonths),
          annualInspectionRequired: tpl.insp,
          tags: tpl.tags,
          technicalDetails: `${tpl.spec}. Manufactured by ${tpl.mfr}. Follow the manufacturer's instructions for use, storage and retirement criteria.`,
        };
        if (tpl.life === "finite-mfg") Object.assign(input, { lifespanMode: "finite", lifespanMonths: tpl.months, expiryBasis: "manufacture_date" });
        else if (tpl.life === "finite-first")
          Object.assign(input, {
            lifespanMode: "finite",
            lifespanMonths: tpl.months,
            expiryBasis: "first_use_date",
            // Most have been used already; a couple are still new and missing first use information.
            firstUseDate: chance(0.85) ? isoMonthsAgo(Math.max(1, mfgMonths - int(1, 3))) : null,
          });
        else if (tpl.life === "explicit") Object.assign(input, { lifespanMode: "explicit", explicitExpiry: chance(0.12) ? isoDaysAgo(int(5, 60)) : isoMonthsAgo(-(int(6, 40))) });
        else Object.assign(input, { lifespanMode: "unlimited" });
        const item = await at(daysAgo(int(185, 200)), (tx) => createInventoryItem(tx, admin, input as InventoryInput));
        created.push({ id: item.id, tpl });
      }
    }

    /* ---------- inspection history (chronological) ---------- */
    const inspectable = created.filter((c) => c.tpl.insp);
    const neverInspected = new Set(inspectable.filter(() => chance(0.03)).map((c) => c.id));
    const overdue = new Set(inspectable.filter((c) => !neverInspected.has(c.id) && chance(0.05)).map((c) => c.id));
    const pool1 = inspectable.filter((c) => !neverInspected.has(c.id));
    // Old annual inspection for everyone, then a recent one for most.
    const rounds: { daysAgo: number; ids: string[] }[] = [];
    const chunk = <X,>(arr: X[], size: number) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));
    chunk(pool1.filter((c) => overdue.has(c.id)), 6).forEach((ids, i) => rounds.push({ daysAgo: 390 + i * 7, ids: ids.map((x) => x.id) }));
    chunk(pool1.filter((c) => !overdue.has(c.id)), 14).forEach((ids, i, all) => rounds.push({ daysAgo: Math.round(175 - (i * 160) / Math.max(1, all.length)), ids: ids.map((x) => x.id) }));
    rounds.sort((a, b) => b.daysAgo - a.daysAgo);
    for (const r of rounds) {
      const inspector = ctxFor(org, pick(admins));
      const when = daysAgo(r.daysAgo, 10);
      await at(when, async (tx) => {
        const res = await recordInspection(tx, inspector, {
          inspectedOn: isoDaysAgo(r.daysAgo),
          notes: pick(["Scheduled thorough examination", "Quarterly PPE check", "Pre-season inspection", "Annual LOLER examination", "Post-course inspection"]),
          records: r.ids.map((id) => ({ itemId: id, outcome: "pass" as const, notes: chance(0.15) ? pick(["Minor scuffs, serviceable", "Label faded, re-marked", "Cleaned and lubricated", "Gate action smooth"]) : null })),
        });
        await tx.update(schema.inspections).set({ createdAt: when }).where(eq(schema.inspections.id, res.id));
      });
    }

    /* ---------- assemblies ---------- */
    async function available(loc: string, name: string, n: number) {
      const rows = await T((tx) =>
        tx.execute<{ id: string }>(sql`
          select i.id from inventory_items i
          where i.organization_id = ${org.id} and i.location_id = ${loc} and i.archived_at is null
            and i.effective_status = 'available' and not i.checkout_blocked
            and i.name ~ ${`^${name} [0-9]+$`}
            and not exists (select 1 from assignments a where a.child_item_id = i.id and a.unassigned_at is null)
            and not exists (select 1 from checkout_items ci where ci.inventory_item_id = i.id and ci.status = 'issued')
            and not exists (select 1 from reservation_items ri where ri.inventory_item_id = i.id and ri.active and ri.ends_at > now())
          order by i.code limit ${n}`),
      );
      return rows.rows.map((r) => r.id);
    }
    async function consumableAt(loc: string, name: string, qty: number) {
      const rows = await T((tx) =>
        tx.execute<{ id: string }>(sql`
          select i.id from inventory_items i join consumable_stock s on s.inventory_item_id = i.id
          where i.organization_id = ${org.id} and i.location_id = ${loc} and i.name = ${name} and i.effective_status = 'available'
            and s.total_quantity - s.allocated_quantity - s.issued_quantity >= ${qty} limit 1`),
      );
      return rows.rows[0]?.id ?? null;
    }

    const builtConfigs: { id: string; recipe: string; loc: string }[] = [];
    for (const recipe of spec.configs) {
      const [{ n: existing }] = await T((tx) =>
        tx.select({ n: sql<number>`count(*)::int` }).from(schema.inventoryItems).where(and(eq(schema.inventoryItems.organizationId, org.id), sql`${schema.inventoryItems.name} ~ ${`^${recipe.name} [0-9]+$`}`)),
      );
      let made = 0;
      for (const loc of [...hubs, ...hubs]) {
        if (made >= recipe.count) break;
        const parts: string[] = [];
        let ok = true;
        for (const [name, count] of recipe.parts) {
          const got = await available(loc, name, count);
          if (got.length < count) {
            ok = false;
            break;
          }
          parts.push(...got);
        }
        if (!ok) continue;
        const when = daysAgo(int(150, 165));
        const cfg = await at(when, async (tx) => {
          const item = await createInventoryItem(tx, admin, {
            kind: "configuration",
            name: `${recipe.name} ${Number(existing) + made + 1}`,
            purpose: recipe.purpose,
            techSpec: recipe.parts.map(([n2, c]) => `${c}× ${n2}`).join(", "),
            locationId: loc,
            lifespanMode: "unlimited",
            annualInspectionRequired: false,
            tags: ["Setup"],
          } as InventoryInput);
          for (const p of parts) await assignChild(tx, admin, item.id, p);
          return item;
        });
        for (const [name, qty] of recipe.consumables ?? []) {
          const cid = await consumableAt(loc, name, qty);
          if (cid) await at(when, (tx) => allocateConsumable(tx, admin, cfg.id, cid, qty));
        }
        builtConfigs.push({ id: cfg.id, recipe: recipe.name, loc });
        made++;
      }
    }

    const builtKits: { id: string; recipe: string; loc: string }[] = [];
    for (const recipe of spec.kits) {
      const [{ n: existing }] = await T((tx) =>
        tx.select({ n: sql<number>`count(*)::int` }).from(schema.inventoryItems).where(and(eq(schema.inventoryItems.organizationId, org.id), sql`${schema.inventoryItems.name} ~ ${`^${recipe.name} [0-9]+$`}`)),
      );
      for (let k = 0; k < recipe.count; k++) {
        // Choose a hub that has every required configuration still free.
        let chosen: { loc: string; cfgs: string[] } | null = null;
        for (const loc of hubs) {
          const pool = builtConfigs.filter((c) => c.loc === loc);
          const cfgs: string[] = [];
          for (const r of recipe.configs) {
            const c = pool.find((p) => p.recipe === r && !cfgs.includes(p.id));
            if (c) cfgs.push(c.id);
          }
          if (cfgs.length === recipe.configs.length) {
            chosen = { loc, cfgs };
            break;
          }
        }
        if (!chosen) continue;
        const nested = recipe.nested ? builtKits.find((b) => b.recipe === recipe.nested && b.loc === chosen!.loc) : undefined;
        const when = daysAgo(int(140, 148));
        const kit = await at(when, async (tx) => {
          const item = await createInventoryItem(tx, admin, {
            kind: "kit",
            name: `${recipe.name} ${Number(existing) + k + 1}`,
            purpose: recipe.purpose,
            techSpec: "Grab-and-go kit",
            locationId: chosen!.loc,
            lifespanMode: "unlimited",
            annualInspectionRequired: false,
            tags: ["Kit"],
          } as InventoryInput);
          for (const c of chosen!.cfgs) await assignChild(tx, admin, item.id, c);
          if (nested) await assignChild(tx, admin, item.id, nested.id);
          for (const [desc, q] of recipe.contents) await addKitContent(tx, admin, item.id, desc, q);
          return item;
        });
        for (const [name, count] of recipe.parts) {
          for (const p of await available(chosen.loc, name, count)) await at(when, (tx) => assignChild(tx, admin, kit.id, p)).catch(() => undefined);
        }
        for (const [name, qty] of recipe.consumables ?? []) {
          const cid = await consumableAt(chosen.loc, name, qty);
          if (cid) await at(when, (tx) => allocateConsumable(tx, admin, kit.id, cid, qty));
        }
        for (const c of chosen.cfgs) builtConfigs.splice(builtConfigs.findIndex((b) => b.id === c), 1);
        if (nested) builtKits.splice(builtKits.indexOf(nested), 1);
        builtKits.push({ id: kit.id, recipe: recipe.name, loc: chosen.loc });
      }
    }

    /* ---------- checkout helpers ---------- */
    async function roots(loc: string, limit: number) {
      const rows = await T((tx) =>
        tx.execute<{ id: string; kind: string }>(sql`
          select i.id, i.kind from inventory_items i
          where i.organization_id = ${org.id} and i.location_id = ${loc} and i.archived_at is null
            and i.kind <> 'consumable' and i.effective_status = 'available' and not i.checkout_blocked
            and not exists (select 1 from assignments a where a.child_item_id = i.id and a.unassigned_at is null)
            and not exists (select 1 from checkout_items ci where ci.inventory_item_id = i.id and ci.status in ('issued','pending'))
            and not exists (select 1 from reservation_items ri where ri.inventory_item_id = i.id and ri.active and ri.ends_at > now())
          order by random() limit ${limit}`),
      );
      return rows.rows;
    }
    async function freeConsumable(loc: string) {
      const rows = await T((tx) =>
        tx.execute<{ id: string; free: number }>(sql`
          select i.id, (s.total_quantity - s.allocated_quantity - s.issued_quantity)::float8 as free
          from inventory_items i join consumable_stock s on s.inventory_item_id = i.id
          where i.organization_id = ${org.id} and i.location_id = ${loc} and i.effective_status = 'available' and not i.checkout_blocked
            and s.total_quantity - s.allocated_quantity - s.issued_quantity > 3
          order by random() limit 1`),
      );
      return rows.rows[0] ?? null;
    }
    const pickTrainer = () => ctxFor(org, trainers.length ? pick(trainers) : pick(admins));

    async function openCheckout(who: Ctx, when: Date, opts: { draftStep?: number } = {}) {
      const loc = pick(hubs.slice(0, Math.min(4, hubs.length)));
      const candidates = await roots(loc, int(1, 3));
      if (!candidates.length) return null;
      const cons = chance(0.45) ? await freeConsumable(loc) : null;
      const event = pick(spec.events);
      return at(when, async (tx) => {
        const d = await createDraftCheckout(tx, who);
        await updateDraftDetails(tx, who, d.id, { step: 1, eventName: event, notes: chance(0.3) ? pick(["Meet at the yard 7:30am", "Client contact on site: front gate", "Vehicle: van 2", "Bring spare chains"]) : null });
        if (opts.draftStep === 1) return d;
        await updateDraftDetails(tx, who, d.id, { step: 2, userId: who.user.id });
        if (opts.draftStep === 2) return d;
        await updateDraftDetails(tx, who, d.id, { step: 3, locationId: loc });
        if (opts.draftStep === 3) return d;
        for (const c of candidates) await addToBasket(tx, who, d.id, { itemId: c.id });
        if (cons) await addToBasket(tx, who, d.id, { itemId: cons.id, quantity: Math.min(int(1, 4), Math.floor(cons.free) - 1) });
        if (opts.draftStep === 4) return d;
        await confirmCheckout(tx, who, d.id);
        return d;
      }).catch(() => null);
    }

    async function returnAll(who: Ctx, checkoutId: string, when: Date, opts: { damageChance?: number; onlyOneRoot?: boolean } = {}) {
      return at(when, async (tx) => {
        const lines = await tx.select().from(schema.checkoutItems).where(and(eq(schema.checkoutItems.checkoutId, checkoutId), eq(schema.checkoutItems.status, "issued")));
        const rootLines = lines.filter((l) => !l.parentCheckoutItemId);
        const selectedRoots = opts.onlyOneRoot ? rootLines.slice(0, 1) : rootLines;
        const included = new Set<string>();
        const collect = (id: string) => {
          included.add(id);
          for (const ch of lines.filter((l) => l.parentCheckoutItemId === id)) collect(ch.id);
        };
        selectedRoots.forEach((r) => collect(r.id));
        const input: ReturnLineInput[] = lines
          .filter((l) => included.has(l.id))
          .map((l) => {
            if (!l.isTracked) {
              const consumed = Math.min(l.quantity, Math.round(l.quantity * rand() * 0.7 * 10) / 10);
              const lost = chance(0.08) ? Math.min(l.quantity - consumed, 0.5) : 0;
              return { checkoutItemId: l.id, outcome: "returned", unused: Math.round((l.quantity - consumed - lost) * 1000) / 1000, consumed, lost };
            }
            if (chance(opts.damageChance ?? 0)) return { checkoutItemId: l.id, outcome: "damaged", note: pick(["Frayed stitching", "Cracked housing", "Sheath glazing", "Bent gate"]) };
            return { checkoutItemId: l.id, outcome: "returned" };
          });
        if (!input.length) return null;
        const res = await processReturn(tx, who, checkoutId, input);
        const day = when.toISOString().slice(0, 10);
        await tx.update(schema.checkoutItems).set({ returnedAt: when }).where(and(eq(schema.checkoutItems.checkoutId, checkoutId), sql`${schema.checkoutItems.returnedAt} is not null and ${schema.checkoutItems.returnedAt} > ${when.toISOString()}::timestamptz`));
        await tx.update(schema.checkouts).set({ completedAt: res.done ? when : null, updatedAt: when }).where(eq(schema.checkouts.id, checkoutId));
        await tx.execute(sql`update inventory_items set last_use_date = ${day}::date where id in (select inventory_item_id from checkout_items where checkout_id = ${checkoutId})`);
        return res;
      });
    }

    async function setCheckoutTimes(id: string, start: Date, due: Date) {
      const day = start.toISOString().slice(0, 10);
      await T(async (tx) => {
        await tx.update(schema.checkouts).set({ startedAt: start, createdAt: start, dueAt: due }).where(eq(schema.checkouts.id, id));
        await tx.execute(sql`update inventory_items set first_use_date = ${day}::date where first_use_date = ${isoDateInZone(new Date(), org.timezone)}::date and id in (select inventory_item_id from checkout_items where checkout_id = ${id})`);
      });
    }

    /* ---------- checkout history ---------- */
    const repairs: string[] = [];
    for (let i = 0; i < spec.history; i++) {
      const startAgo = Math.round(140 - (i * 132) / spec.history) + int(0, 3);
      const start = daysAgo(startAgo, int(7, 10));
      const who = chance(0.8) ? pickTrainer() : admin;
      const d = await openCheckout(who, start);
      if (!d) continue;
      const lengthDays = int(1, 4);
      await setCheckoutTimes(d.id, start, new Date(start.getTime() + (lengthDays + 1) * DAY));
      const ret = new Date(start.getTime() + lengthDays * DAY + int(1, 6) * 3600_000);
      await returnAll(who, d.id, ret, { damageChance: 0.05 }).catch((e) => console.warn("return failed", e.message));
      repairs.push(d.id);
    }

    // Damaged returns get inspected a few days later; most pass, a few are rejected.
    const damaged = await T((tx) =>
      tx.execute<{ id: string }>(sql`select i.id from inventory_items i where i.organization_id = ${org.id} and i.status = 'needs_inspection'
        and exists (select 1 from status_history h where h.inventory_item_id = i.id and h.source = 'return')`),
    );
    if (damaged.rows.length) {
      await at(daysAgo(6), (tx) =>
        recordInspection(tx, ctxFor(org, pick(admins)), {
          inspectedOn: isoDaysAgo(6),
          notes: "Post-return damage assessment",
          records: damaged.rows.map((r, idx) => ({
            itemId: r.id,
            outcome: idx % 4 === 3 ? ("fail" as const) : ("pass" as const),
            notes: idx % 4 === 3 ? "Damage beyond repair, quarantined" : "Repaired and tested",
          })),
        }),
      );
    }

    /* ---------- current status variety ---------- */
    const flagged = (await roots(hubs[0], 3)).filter((r) => r.kind === "component");
    for (const f of flagged.slice(0, 2)) {
      await at(daysAgo(int(1, 4)), (tx) => setItemStatus(tx, anyone(), f.id, "needs_inspection", pick(["Reported stiff gate", "Small cut in sheath", "Strap fraying near buckle", "Visor scratched"]), "report"));
    }
    const lost = (await roots(hubs[Math.min(1, hubs.length - 1)], 2)).filter((r) => r.kind === "component");
    if (lost[0]) await at(daysAgo(int(8, 20)), (tx) => setItemStatus(tx, admin, lost[0].id, "missing", "Not found at stocktake"));

    /* ---------- active sessions (each trainer has work in progress) ---------- */
    const people = [...trainers, ...admins];
    for (const [idx, person] of people.entries()) {
      const who = ctxFor(org, person);
      const sessions = person.role === "org_admin" ? 1 : int(1, 2);
      for (let s = 0; s < sessions; s++) {
        const startAgo = int(0, 6);
        const start = daysAgo(startAgo, int(7, 11));
        const d = await openCheckout(who, start);
        if (!d) continue;
        const overdue = idx % 3 === 1 && s === 0;
        const due = overdue ? new Date(Date.now() - int(1, 2) * DAY) : new Date(Date.now() + int(1, 6) * DAY);
        await setCheckoutTimes(d.id, start, due);
        if (idx % 4 === 2 && s === 0) {
          await returnAll(who, d.id, new Date(Math.min(Date.now() - 3600_000, start.getTime() + DAY)), { onlyOneRoot: true }).catch(() => null);
        }
      }
      // In-progress drafts at different steps.
      if (person.role === "trainer" || idx === people.length - 1) {
        await openCheckout(who, new Date(Date.now() - int(1, 30) * 60_000), { draftStep: (idx % 4) + 1 });
      }
    }

    /* ---------- reservations ---------- */
    const resPeople = people.length ? people : admins;
    let r = 0;
    for (const name of [...spec.reservations, ...spec.reservations]) {
      const who = ctxFor(org, resPeople[r % resPeople.length]);
      r++;
      const loc = pick(hubs.slice(0, Math.min(3, hubs.length)));
      const items = await roots(loc, int(1, 3));
      if (!items.length) continue;
      const startDay = int(1, 40);
      const s = new Date(Date.now() + startDay * DAY);
      s.setUTCHours(int(14, 17), 0, 0, 0);
      const e = new Date(s.getTime() + int(4, 30) * 3600_000);
      const res = await at(daysAgo(int(1, 20)), (tx) =>
        createReservation(tx, who, {
          eventName: name,
          startsAt: s.toISOString(),
          endsAt: e.toISOString(),
          locationId: loc,
          notes: chance(0.4) ? pick(["Client confirmed headcount", "Transport booked", "Awaiting PO"]) : null,
          items: items.map((it) => ({ itemId: it.id })),
        }),
      ).catch(() => null);
      if (!res) continue;
      if (chance(0.15)) await at(daysAgo(int(0, 2)), (tx) => cancelReservation(tx, who, res.id, pick(["Event postponed", "Client cancelled", "Weather"])));
    }
    // A few past reservations that were fulfilled.
    for (let p = 0; p < Math.min(6, spec.history); p++) {
      const loc = hubs[0];
      const items = await roots(loc, 1);
      if (!items.length) break;
      const who = ctxFor(org, pick(resPeople));
      const res = await at(daysAgo(int(40, 120)), (tx) =>
        createReservation(tx, who, {
          eventName: pick(spec.events),
          startsAt: new Date(Date.now() + 200 * DAY + p * DAY).toISOString(),
          endsAt: new Date(Date.now() + 200 * DAY + p * DAY + 6 * 3600_000).toISOString(),
          locationId: loc,
          items: [{ itemId: items[0].id }],
        }),
      ).catch(() => null);
      if (!res) continue;
      const start = daysAgo(int(10, 100), 8);
      await T(async (tx) => {
        await tx.update(schema.reservations).set({ startsAt: start, endsAt: new Date(start.getTime() + 8 * 3600_000), status: "fulfilled" }).where(eq(schema.reservations.id, res.id));
        await tx.update(schema.reservationItems).set({ startsAt: start, endsAt: new Date(start.getTime() + 8 * 3600_000), active: false }).where(eq(schema.reservationItems.reservationId, res.id));
      });
    }

    /* ---------- attachments ---------- */
    const docs = ["user-manual.pdf", "certificate-of-conformity.pdf", "inspection-report.pdf"];
    const withPhotos = created.filter((c) => c.tpl.photo).slice(0, 24);
    for (const [i, c] of withPhotos.entries()) {
      const files = [`${c.tpl.photo}.jpg`, docs[i % docs.length]];
      if (i % 3 === 0) files.push(docs[(i + 1) % docs.length]);
      for (const f of files) {
        const data = readFileSync(path.join(ASSETS, f));
        await at(daysAgo(int(100, 180)), async (tx) => {
          const initRes = await initAttachment(tx, admin, c.id, {
            fileName: f.endsWith(".jpg") ? `${c.tpl.name.toLowerCase().replace(/\s+/g, "-")}-photo.jpg` : f,
            contentType: f.endsWith(".jpg") ? "image/jpeg" : "application/pdf",
            size: data.length,
          });
          for (let k = 0; k < initRes.chunkCount; k++) {
            await putAttachmentChunk(tx, admin, initRes.id, k, data.subarray(k * initRes.chunkSize, (k + 1) * initRes.chunkSize));
          }
          await completeAttachment(tx, admin, initRes.id);
        });
      }
    }

    await T((tx) => recomputeOrgStatuses(tx, org.id, { source: "daily" }));
    if (spec.create?.inactive) {
      await withSystem((tx) => tx.update(schema.organizations).set({ status: "inactive" }).where(eq(schema.organizations.id, org.id)));
    }
    void repairs;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
