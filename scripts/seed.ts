import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import { makeTenantRunners, type Tx } from "../src/db/tenant";
import { hashPassword } from "../src/server/auth/password";
import { permissionsFor } from "../src/server/auth/permissions";
import {
  addKitContent,
  allocateConsumable,
  assignChild,
  createInventoryItem,
} from "../src/server/inventory";
import { addToBasket, confirmCheckout, createDraftCheckout, processReturn, updateDraftDetails } from "../src/server/checkout";
import { createReservation } from "../src/server/reservations";
import { recordInspection } from "../src/server/inspections";
import { recomputeOrgStatuses } from "../src/server/status-engine";
import { addMonthsIso, isoDateInZone } from "../src/lib/utils";
import type { InventoryInput } from "../src/lib/validators";

/**
 * Seeds demonstration data through the real domain services (codes, stock ledger,
 * QR tokens, status propagation and audit history are all genuine).
 * Usage: pnpm db:seed            (refuses to run if data exists)
 *        pnpm db:seed --reset    (wipes all application data first)
 */

const { organizations, users, locations } = schema;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password) throw new Error("SEED_DEMO_PASSWORD is not set");
  const superEmail = (process.env.SEED_SUPER_ADMIN_EMAIL ?? "super@geartractor.app").toLowerCase();

  const pool = new Pool({ connectionString: url, max: 2 });
  const db = drizzle(pool, { schema });
  const { withSystem, withTenant } = makeTenantRunners(db);

  const reset = process.argv.includes("--reset");
  const existing = await withSystem((tx) => tx.select({ id: organizations.id }).from(organizations).limit(1));
  if (existing.length && !reset) {
    console.log("Database already contains data. Re-run with --reset to wipe and reseed.");
    await pool.end();
    return;
  }
  if (reset) {
    const ownerUrl = process.env.DATABASE_URL_OWNER;
    if (!ownerUrl) throw new Error("--reset requires DATABASE_URL_OWNER");
    const owner = new Pool({ connectionString: ownerUrl, max: 1 });
    const tables = await owner.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public'",
    );
    await owner.query(`truncate ${tables.rows.map((t) => `"${t.tablename}"`).join(", ")} cascade`);
    await owner.end();
    console.log("Existing data removed");
  }

  const hash = await hashPassword(password);
  const zone = "America/Edmonton";
  const today = isoDateInZone(new Date(), zone);
  const d = (months: number, days = 0) => {
    const base = addMonthsIso(today, months);
    const t = new Date(`${base}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + days);
    return t.toISOString().slice(0, 10);
  };

  /* ---------------- Platform ---------------- */
  const { gt, tegnol, dj, sam, maya } = await withSystem(async (tx) => {
    await tx.insert(users).values({ email: superEmail, name: "Platform Admin", role: "super_admin", status: "active", passwordHash: hash });
    const [gt] = await tx
      .insert(organizations)
      .values({
        name: "Gear Tractor",
        slug: "gear-tractor",
        primaryColor: "#FF6B1A",
        secondaryColor: "#2563EB",
        accentColor: "#E11D74",
        timezone: zone,
        contactName: "DJ Fernandez",
        contactEmail: "ops@geartractor.app",
        contactPhone: "+1 403 555 0142",
        address: "1200 Industrial Way, Calgary, AB",
        settings: { trainersCanInspect: false, allowReservedOverride: true, defaultCheckoutDays: 7 },
      })
      .returning();
    const [tegnol] = await tx
      .insert(organizations)
      .values({
        name: "Tegnol",
        slug: "tegnol",
        primaryColor: "#7C3AED",
        secondaryColor: "#0EA5E9",
        accentColor: "#F43F5E",
        timezone: "Asia/Karachi",
        contactEmail: "hello@tegnol.agency",
        settings: { trainersCanInspect: true, allowReservedOverride: false, defaultCheckoutDays: 3 },
      })
      .returning();
    const [dj] = await tx
      .insert(users)
      .values({ organizationId: gt.id, email: "dj@geartractor.app", name: "DJ Fernandez", role: "org_admin", status: "active", passwordHash: hash })
      .returning();
    const [sam] = await tx
      .insert(users)
      .values({ organizationId: gt.id, email: "sam@geartractor.app", name: "Sam Rivera", role: "trainer", status: "active", passwordHash: hash })
      .returning();
    const [maya] = await tx
      .insert(users)
      .values({ organizationId: gt.id, email: "maya@geartractor.app", name: "Maya Chen", role: "trainer", status: "active", passwordHash: hash })
      .returning();
    await tx.insert(users).values({ organizationId: gt.id, email: "jordan@geartractor.app", name: "Jordan Blake", role: "trainer", status: "invited" });
    await tx
      .insert(users)
      .values({ organizationId: tegnol.id, email: "admin@tegnol.agency", name: "Talha S.", role: "org_admin", status: "active", passwordHash: hash });
    return { gt, tegnol, dj, sam, maya };
  });

  const ctxFor = (org: typeof gt, user: typeof dj) => ({
    orgId: org.id,
    org: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      logoDataUrl: null,
      primaryColor: org.primaryColor,
      secondaryColor: org.secondaryColor,
      accentColor: org.accentColor,
      timezone: org.timezone,
      settings: org.settings,
    },
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      phone: null,
      notifyEmail: true,
      notifyOverdue: true,
      notifyInspections: true,
    },
    can: (p: Parameters<ReturnType<typeof permissionsFor>["has"]>[0]) => permissionsFor(user.role, org.settings).has(p),
  });
  const admin = ctxFor(gt, dj);
  const samCtx = ctxFor(gt, sam);

  /* ---------------- Gear Tractor data ---------------- */
  await withTenant(gt.id, async (tx) => {
    const loc: Record<string, string> = {};
    for (const [name, code, description] of [
      ["Main Warehouse", "MAIN", "Primary storage and dispatch"],
      ["Workshop", "WSHP", "Servicing, sharpening and repairs"],
      ["Training Yard", "YARD", "Outdoor training ground storage"],
      ["Field Storage", "FIELD", "Mobile container for field courses"],
      ["Lock-Up A", "LUA", "Secure event lock-up"],
    ] as const) {
      const [row] = await tx.insert(locations).values({ organizationId: gt.id, name, code, description }).returning();
      loc[name] = row.id;
    }

    const make = async (input: Partial<InventoryInput> & Pick<InventoryInput, "kind" | "name">, locationName = "Main Warehouse") =>
      createInventoryItem(tx, admin, {
        locationId: loc[locationName],
        annualInspectionRequired: input.kind === "component",
        ...input,
      } as InventoryInput);

    // ---- Components ----
    const chainsaw = async (n: number, locName = "Main Warehouse") =>
      make(
        {
          kind: "component",
          name: `Chainsaw ${n}`,
          techSpec: "Stihl MS 261 C-M, 18in bar",
          manufacturer: "Stihl",
          serialNumber: `MS261-${4800 + n}`,
          manufactureDate: d(-30),
          lifespanMode: "unlimited",
          lastInspectionDate: d(-3),
          tags: ["Chainsaw", "Powered"],
          technicalDetails: "Two-stroke 50.2cc. Chain: 3/8in .050 gauge. Service every 50 hours.",
        },
        locName,
      );
    const helmet = async (n: number, opts: Partial<InventoryInput> = {}) =>
      make({
        kind: "component",
        name: `Helmet ${n}`,
        techSpec: "Petzl Vertex Vent, EN 397 / EN 12492",
        manufacturer: "Petzl",
        serialNumber: `VTX-${21000 + n}`,
        manufactureDate: d(-36),
        lifespanMode: "finite",
        lifespanMonths: 120,
        expiryBasis: "manufacture_date",
        lastInspectionDate: d(-4),
        tags: ["PPE", "Head protection"],
        ...opts,
      });
    const harness = async (n: number, opts: Partial<InventoryInput> = {}) =>
      make({
        kind: "component",
        name: `Harness ${n}`,
        techSpec: "Petzl Avao Bod Fast, EN 361 / EN 358 / EN 813",
        manufacturer: "Petzl",
        serialNumber: `AVB-${33000 + n}`,
        manufactureDate: d(-20),
        firstUseDate: d(-18),
        lifespanMode: "finite",
        lifespanMonths: 120,
        expiryBasis: "manufacture_date",
        lastInspectionDate: d(-5),
        tags: ["PPE", "Fall protection"],
        ...opts,
      });
    const rope = async (n: number, opts: Partial<InventoryInput> = {}) =>
      make({
        kind: "component",
        name: `Rope ${n}`,
        techSpec: "Petzl Parallel 10.5mm, 50m, EN 1891 A",
        manufacturer: "Petzl",
        serialNumber: `PAR-${5100 + n}`,
        manufactureDate: d(-14),
        firstUseDate: d(-12),
        lifespanMode: "finite",
        lifespanMonths: 120,
        expiryBasis: "first_use_date",
        lastInspectionDate: d(-2),
        tags: ["Rope", "Fall protection"],
        ...opts,
      });
    const carabiner = async (n: number, opts: Partial<InventoryInput> = {}) =>
      make({
        kind: "component",
        name: `Carabiner ${n}`,
        techSpec: "Petzl Am'D Triact-Lock, 27kN",
        manufacturer: "Petzl",
        serialNumber: `AMD-${7700 + n}`,
        lifespanMode: "unlimited",
        lastInspectionDate: d(-6),
        tags: ["Connector", "Fall protection"],
        ...opts,
      });

    const saws = [await chainsaw(1), await chainsaw(2), await chainsaw(3, "Workshop")];
    const helmets = [
      await helmet(1),
      await helmet(2),
      await helmet(3),
      // Becomes expired (hard expiry) after it is applied to the Climbing Setup below.
      await helmet(4),
      // Inspection overdue.
      await helmet(5, { lastInspectionDate: d(-14) }),
    ];
    const harnesses = [
      await harness(1),
      await harness(2),
      await harness(3, { status: "needs_inspection", statusReason: "Stitching wear noted by trainer" }),
    ];
    const ropes = [
      await rope(1),
      await rope(2),
      await rope(3, { status: "rejected", statusReason: "Core shot found at 12m during inspection" }),
    ];
    const cbs = [];
    for (let i = 1; i <= 8; i++) cbs.push(await carabiner(i));
    const cbOverdue = await carabiner(9);
    const cbMissing = await carabiner(10, { status: "missing", statusReason: "Not returned after Spring Rescue Course" });

    const descender = await make({
      kind: "component",
      name: "Descender 1",
      techSpec: "Petzl I'D S, EN 12841 C",
      manufacturer: "Petzl",
      serialNumber: "IDS-9001",
      lifespanMode: "unlimited",
      lastInspectionDate: d(-3),
      tags: ["Descender", "Rope access"],
    });
    const chaps = [1, 2].map(() => null);
    const chapsItems = [];
    for (let i = 1; i <= 2; i++) {
      chapsItems.push(
        await make({
          kind: "component",
          name: `Chainsaw Chaps ${i}`,
          techSpec: "Husqvarna Technical, Class 1, EN ISO 11393",
          manufacturer: "Husqvarna",
          serialNumber: `HTC-${600 + i}`,
          manufactureDate: d(-10),
          lifespanMode: "finite",
          lifespanMonths: 60,
          expiryBasis: "manufacture_date",
          lastInspectionDate: d(-2),
          tags: ["PPE", "Safety Equipment"],
        }),
      );
    }
    void chaps;
    const earDefenders = await make({
      kind: "component",
      name: "Ear Defenders 1",
      techSpec: "3M Peltor X4A, SNR 33dB",
      manufacturer: "3M",
      lifespanMode: "explicit",
      explicitExpiry: d(30),
      lastInspectionDate: d(-1),
      tags: ["PPE", "Safety Equipment"],
    });
    const firstAid = await make({
      kind: "component",
      name: "First Aid Kit (Trauma)",
      techSpec: "Class 2 workplace kit with tourniquet",
      manufacturer: "St John",
      lifespanMode: "explicit",
      explicitExpiry: d(9),
      annualInspectionRequired: false,
      tags: ["Safety Equipment", "Medical"],
    });
    const firstAid2 = await make({
      kind: "component",
      name: "First Aid Kit (Field)",
      techSpec: "Class 1 compact kit",
      manufacturer: "St John",
      lifespanMode: "explicit",
      explicitExpiry: d(14),
      annualInspectionRequired: false,
      tags: ["Safety Equipment", "Medical"],
    });
    // Missing expiry information: finite lifespan based on first use, never used.
    await make({
      kind: "component",
      name: "Lanyard 1",
      techSpec: "Petzl Progress Adjust-Y",
      manufacturer: "Petzl",
      lifespanMode: "finite",
      lifespanMonths: 120,
      expiryBasis: "first_use_date",
      lastInspectionDate: d(-1),
      tags: ["Fall protection"],
    });
    const asap = await make(
      {
        kind: "component",
        name: "Fall Arrester 1",
        techSpec: "Petzl ASAP Lock, EN 12841 A",
        manufacturer: "Petzl",
        serialNumber: "ASAP-3120",
        lifespanMode: "unlimited",
        lastInspectionDate: d(-2),
        tags: ["Rope access"],
      },
      "Lock-Up A",
    );
    const yardHarness = await harness(4);
    void yardHarness;

    // ---- Consumables ----
    const consumable = async (name: string, unit: "units" | "metres" | "litres" | "kg", qty: number, threshold: number, extra: Partial<InventoryInput> = {}, locName = "Main Warehouse") =>
      make(
        {
          kind: "consumable",
          name,
          quantityUnit: unit,
          initialQuantity: qty,
          reorderThreshold: threshold,
          lifespanMode: "unlimited",
          annualInspectionRequired: false,
          tags: ["Consumable"],
          ...extra,
        },
        locName,
      );
    const fuel = await consumable("Fuel (2-stroke mix)", "litres", 40, 10, { techSpec: "Aspen 2T alkylate, 50:1", manufacturer: "Aspen", lifespanMode: "explicit", explicitExpiry: d(18) });
    const oil = await consumable("Bar & Chain Oil", "litres", 10, 10, { techSpec: "Stihl BioPlus", manufacturer: "Stihl" });
    const tape = await consumable("Tape", "units", 6, 8, { techSpec: "Climbing tape 38mm x 10m", manufacturer: "Metolius" });
    const cord = await consumable("Rope (accessory cord)", "metres", 200, 50, { techSpec: "6mm accessory cord", manufacturer: "Beal" });
    const cleaning = await consumable("Cleaning Supplies", "units", 4, 5, { techSpec: "Gear wash + brushes", manufacturer: "Nikwax" });
    await consumable("Fuel (2-stroke mix)", "litres", 20, 5, { techSpec: "Aspen 2T alkylate, 50:1", manufacturer: "Aspen", lifespanMode: "explicit", explicitExpiry: d(18) }, "Workshop");

    // ---- Configurations ----
    const config = async (name: string, purpose: string, techSpec: string, locName = "Main Warehouse") =>
      make({ kind: "configuration", name, purpose, techSpec, lifespanMode: "unlimited", annualInspectionRequired: false, tags: ["Setup"] }, locName);

    const chainsawSetup = await config("Chainsaw Setup 1", "Felling and crosscutting for Level 1 courses", "Saw + PPE + fuel");
    for (const c of [saws[0], helmets[0], chapsItems[0], earDefenders]) await assignChild(tx, admin, chainsawSetup.id, c.id);
    await allocateConsumable(tx, admin, chainsawSetup.id, fuel.id, 4);
    await allocateConsumable(tx, admin, chainsawSetup.id, oil.id, 1);

    const chainsawSetup2 = await config("Chainsaw Setup 2", "Spare saw setup", "Saw + PPE");
    for (const c of [saws[1], chapsItems[1]]) await assignChild(tx, admin, chainsawSetup2.id, c.id);

    const ropeAccess = await config("Rope Access Setup 1", "Two-rope working system", "Harness + descender + backup");
    for (const c of [harnesses[0], descender, cbs[0], cbs[1], ropes[0]]) await assignChild(tx, admin, ropeAccess.id, c.id);

    const climbing = await config("Climbing Setup 1", "Tree climbing (SRT)", "Harness + helmet + connectors + rope");
    for (const c of [harnesses[1], helmets[3], cbs[2], cbOverdue, ropes[1]]) await assignChild(tx, admin, climbing.id, c.id);
    await allocateConsumable(tx, admin, climbing.id, tape.id, 2);

    // ---- Kits ----
    const kit = async (name: string, purpose: string) =>
      make({ kind: "kit", name, purpose, techSpec: "Grab-and-go kit", lifespanMode: "unlimited", annualInspectionRequired: false, tags: ["Kit"] });

    const fieldKit = await kit("Field Kit", "Chainsaw field course kit");
    await assignChild(tx, admin, fieldKit.id, chainsawSetup.id);
    await assignChild(tx, admin, fieldKit.id, firstAid.id);
    await allocateConsumable(tx, admin, fieldKit.id, cleaning.id, 1);
    await addKitContent(tx, admin, fieldKit.id, "Chain file set (4.0mm)", "1 set");
    await addKitContent(tx, admin, fieldKit.id, "Laminated felling SOP card", "2");

    const emergencyKit = await kit("Emergency Kit", "Rescue and first response");
    await assignChild(tx, admin, emergencyKit.id, firstAid2.id);
    await assignChild(tx, admin, emergencyKit.id, cbs[3].id);
    await allocateConsumable(tx, admin, emergencyKit.id, cord.id, 30);
    await addKitContent(tx, admin, emergencyKit.id, "Emergency whistle", "1");
    await addKitContent(tx, admin, emergencyKit.id, "Foil blanket", "2");

    const trainingKit = await kit("Training Kit", "Tree climbing training kit");
    await assignChild(tx, admin, trainingKit.id, climbing.id);
    await assignChild(tx, admin, trainingKit.id, emergencyKit.id);
    await allocateConsumable(tx, admin, trainingKit.id, tape.id, 3);

    // Age some gear that is already in service: an expired helmet and an overdue carabiner.
    await tx.execute(sql`update inventory_items set manufacture_date = ${d(-132)}::date where id = ${helmets[3].id}`);
    await tx.execute(sql`update inventory_items set last_inspection_date = ${d(-13)}::date, next_inspection_date = ${d(-1)}::date where id = ${cbOverdue.id}`);

    // Consumable shortage: tape allocation partly consumed on a past course.
    await tx.execute(sql`update consumable_allocations set allocated_quantity = 1 where parent_item_id = ${trainingKit.id}`);
    await tx.execute(sql`update consumable_stock set allocated_quantity = allocated_quantity - 2, total_quantity = total_quantity - 2, consumed_total = consumed_total + 2 where inventory_item_id = ${tape.id}`);
    await recomputeOrgStatuses(tx, gt.id);

    // ---- Past inspection (bulk) ----
    await recordInspection(tx, admin, {
      inspectedOn: d(0, -20),
      notes: "Quarterly PPE check",
      records: [
        { itemId: cbs[4].id, outcome: "pass" },
        { itemId: cbs[5].id, outcome: "pass" },
        { itemId: helmets[2].id, outcome: "pass", notes: "Minor scuffs, serviceable" },
      ],
    });

    // ---- Checkout history ----
    const past = await createDraftCheckout(tx, samCtx);
    await updateDraftDetails(tx, samCtx, past.id, { step: 1, eventName: "Spring Rescue Course" });
    await updateDraftDetails(tx, samCtx, past.id, { step: 2, userId: sam.id });
    await updateDraftDetails(tx, samCtx, past.id, { step: 3, locationId: loc["Main Warehouse"] });
    await addToBasket(tx, samCtx, past.id, { itemId: helmets[1].id });
    await addToBasket(tx, samCtx, past.id, { itemId: fuel.id, quantity: 5 });
    await confirmCheckout(tx, samCtx, past.id);
    const pastLines = await tx.select().from(schema.checkoutItems).where(eq(schema.checkoutItems.checkoutId, past.id));
    await processReturn(
      tx,
      samCtx,
      past.id,
      pastLines.map((l) =>
        l.isTracked
          ? { checkoutItemId: l.id, outcome: "returned" as const }
          : { checkoutItemId: l.id, outcome: "returned" as const, unused: 1.5, consumed: 3.5, lost: 0 },
      ),
    );
    await tx.execute(sql`update checkouts set started_at = now() - interval '12 days', completed_at = now() - interval '10 days', created_at = now() - interval '12 days' where id = ${past.id}`);

    // ---- Active session 1: Corporate Gala - TechCorp (Lock-Up A, 1 item out, 4 days ago) ----
    const gala = await createDraftCheckout(tx, admin);
    await updateDraftDetails(tx, admin, gala.id, { step: 1, eventName: "Corporate Gala – TechCorp", dueAt: new Date(Date.now() + 3 * 86400_000).toISOString() });
    await updateDraftDetails(tx, admin, gala.id, { step: 2, userId: dj.id });
    await updateDraftDetails(tx, admin, gala.id, { step: 3, locationId: loc["Lock-Up A"] });
    await addToBasket(tx, admin, gala.id, { itemId: asap.id });
    await confirmCheckout(tx, admin, gala.id);
    await tx.execute(sql`update checkouts set started_at = now() - interval '4 days', created_at = now() - interval '4 days' where id = ${gala.id}`);

    // ---- Active session 2: Chainsaw Safety Level 1 (Field Kit, overdue) ----
    // The Field Kit contains the Chainsaw Setup (4 components + fuel/oil allocations).
    const chainsawCourse = await createDraftCheckout(tx, admin);
    await updateDraftDetails(tx, admin, chainsawCourse.id, { step: 1, eventName: "Chainsaw Safety Level 1" });
    await updateDraftDetails(tx, admin, chainsawCourse.id, { step: 2, userId: sam.id });
    await updateDraftDetails(tx, admin, chainsawCourse.id, { step: 3, locationId: loc["Main Warehouse"] });
    await addToBasket(tx, admin, chainsawCourse.id, { itemId: fieldKit.id });
    await addToBasket(tx, admin, chainsawCourse.id, { itemId: ropeAccess.id });
    await addToBasket(tx, admin, chainsawCourse.id, { itemId: fuel.id, quantity: 5 });
    await confirmCheckout(tx, admin, chainsawCourse.id);
    await tx.execute(sql`update checkouts set started_at = now() - interval '3 days', created_at = now() - interval '3 days', due_at = now() - interval '1 day' where id = ${chainsawCourse.id}`);

    // ---- In-progress checkout (Step 2 of 4) ----
    const draft = await createDraftCheckout(tx, admin);
    await updateDraftDetails(tx, admin, draft.id, { step: 1, eventName: "Alberta Field Course" });

    // ---- Reservations ----
    const start = new Date(Date.now() + 5 * 86400_000);
    start.setUTCHours(15, 0, 0, 0);
    const end = new Date(start.getTime() + 8 * 3600_000);
    await createReservation(tx, admin, {
      eventName: "Arborist Assessment Day",
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      locationId: loc["Main Warehouse"],
      userId: maya.id,
      items: [
        { itemId: chainsawSetup2.id },
        { itemId: helmets[2].id },
        { itemId: fuel.id, quantity: 5 },
      ],
    });
    const start2 = new Date(Date.now() + 9 * 86400_000);
    start2.setUTCHours(14, 0, 0, 0);
    await createReservation(tx, samCtx, {
      eventName: "Tree Climbing Workshop",
      startsAt: start2.toISOString(),
      endsAt: new Date(start2.getTime() + 6 * 3600_000).toISOString(),
      locationId: loc["Main Warehouse"],
      items: [{ itemId: harnesses[2].id }, { itemId: cbs[6].id }, { itemId: cbs[7].id }],
    });
    void cbMissing;
    void helmets[4];
    void saws[2];
  });

  /* ---------------- Tegnol (second tenant) ---------------- */
  const [tegnolAdmin] = await withSystem((tx) =>
    tx.select().from(users).where(eq(users.email, "admin@tegnol.agency")),
  );
  const tegCtx = ctxFor(tegnol, tegnolAdmin);
  await withTenant(tegnol.id, async (tx: Tx) => {
    const [studio] = await tx.insert(locations).values({ organizationId: tegnol.id, name: "Karachi Studio", code: "KHI" }).returning();
    const [store] = await tx.insert(locations).values({ organizationId: tegnol.id, name: "Equipment Room", code: "EQR" }).returning();
    const cam = await createInventoryItem(tx, tegCtx, {
      kind: "component",
      name: "Camera Body",
      techSpec: "Sony FX3",
      manufacturer: "Sony",
      locationId: studio.id,
      lifespanMode: "unlimited",
      annualInspectionRequired: true,
      lastInspectionDate: d(-2),
      tags: ["Video"],
    });
    const lens = await createInventoryItem(tx, tegCtx, {
      kind: "component",
      name: "Lens 24-70mm",
      techSpec: "Sony FE 24-70mm f/2.8 GM II",
      manufacturer: "Sony",
      locationId: studio.id,
      lifespanMode: "unlimited",
      annualInspectionRequired: false,
      tags: ["Video"],
    });
    const rig = await createInventoryItem(tx, tegCtx, {
      kind: "configuration",
      name: "Shoot Rig A",
      locationId: studio.id,
      lifespanMode: "unlimited",
      tags: ["Video"],
    });
    await assignChild(tx, tegCtx, rig.id, cam.id);
    await assignChild(tx, tegCtx, rig.id, lens.id);
    await createInventoryItem(tx, tegCtx, {
      kind: "consumable",
      name: "Gaffer Tape",
      locationId: store.id,
      quantityUnit: "units",
      initialQuantity: 24,
      reorderThreshold: 6,
      lifespanMode: "unlimited",
    });
  });

  await pool.end();
  console.log("Seed complete");
  console.log(`  Super admin:   ${superEmail}`);
  console.log("  Org admin:     dj@geartractor.app");
  console.log("  Trainer:       sam@geartractor.app");
  console.log("  Tegnol admin:  admin@tegnol.agency");
  console.log("  Password:      (SEED_DEMO_PASSWORD)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
