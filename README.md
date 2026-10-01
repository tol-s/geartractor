# Gear Tractor

Gear Tractor is a multi-tenant equipment management SaaS for **Components, Configurations, Kits and Consumables**. It covers QR scanning, checkout, check-in, reservations, inspections, status propagation, audit history and CSV exports. The product is mobile-first and animated, and every organization gets its own branding.

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind CSS v4, shadcn-style components on Radix, Lucide icons, Framer Motion, Sonner |
| Backend | Next.js server components, server actions and route handlers (Node runtime) |
| Database | PostgreSQL (Neon) with Drizzle ORM and SQL migrations |
| Auth | Email/password (bcrypt), database sessions (httpOnly cookie), invitations, password reset, rate limiting |
| Hosting | Vercel (with a daily Vercel Cron for time-based status refresh) |

## Architecture highlights

### Multi-tenancy is enforced in the database
* Every tenant-owned table has `organization_id`. **Postgres row-level security** is enabled and **forced** on all of them, including `users` and `audit_logs`.
* Every request runs inside a transaction that pins the tenant with `set_config('app.org_id', …, true)` (`src/db/tenant.ts`). The organization is always derived from the authenticated session (`src/server/auth/context.ts`), never from client input.
* The app connects as a restricted role (`gt_app`, `NOBYPASSRLS`). Migrations run as the owner. Neon owner roles have `BYPASSRLS`, so this separation is required.
* Triggers reject cross-tenant relationships (assignments, allocations, checkout and reservation lines).
* Service code also filters by `organization_id`, so isolation holds in two layers.

### Inventory model
* `inventory_items` holds Components, Configurations, Kits and Consumables, with per-tenant codes (`CPT-000031`, `CFG-…`, `KIT-…`, `CON-…`).
* `assignments` links tracked parents and children. A partial unique index guarantees **one immediate parent**. Cycle, self-reference, type, location, status, checkout and reservation rules are checked under locks.
* `kit_contents` holds descriptive manual contents (no stock, QR or inspections).
* `consumable_stock`, `consumable_allocations` and `consumable_movements` form the stock ledger: Total Remaining, Unallocated, Allocated, Issued, Unused Return, Consumed, Loss and Adjustments. Check constraints make over-allocation and negative stock impossible. Units are never converted.

### Status engine (`src/lib/status-rules.ts`)
* Lifespan can be Finite (Manufacture or First Use basis), Explicit Expiry or Unlimited. The earlier applicable expiry wins. Missing expiry information blocks checkout. Unlimited items show "Pending Inspection".
* Statuses are Available, Needs Inspection, Missing and Rejected, with priority Rejected > Missing > Needs Inspection. Expiry and overdue inspection raise Needs Inspection.
* Problems propagate along every nested path (Component → Configuration → Kit), and **all contributing reasons** are stored with their path. A parent can never be Available while a restricted child remains.
* Availability is tracked separately from status: Checked Out, Reserved, Assigned and Insufficient Stock.
* Effective statuses are recomputed inside every mutating transaction, serialized per tenant with an advisory lock. Time-based rules refresh daily, both from the cron and on the first visit of the day.

### Checkout engine (`src/server/checkout.ts`)
* A draft is persisted at each of the four steps (Event, Trainer, Location, Equipment), which powers the "In Progress Checkout" card.
* Confirmation is a single transaction. It re-validates status, expiry, inspection, location, assignment, reservation and stock, then locks every involved row (`SELECT … FOR UPDATE`, sorted).
* A partial unique index (`checkout_items_one_issued`) guarantees at the database level that a tracked item is issued only once.
* Assemblies are expanded so that every tracked descendant and every allocated consumable is issued **exactly once**.
* Returns support partial check-in; Returned, Missing, Damaged and Exception outcomes; and Unused, Consumed and Loss for consumables. History is preserved.

### Reservations
* Overlaps are prevented by a Postgres **exclusion constraint** (`btree_gist` on item plus time range), with app-level validation and per-tenant serialization on top.
* Equipment reserved for another session cannot be checked out. The one exception is an admin override, which needs an org setting, an explicit flag and a reason, and is audited.

## Getting started (local)

```bash
pnpm install
cp .env.example .env            # fill in values (see below)
pnpm db:setup                   # migrations + RLS-restricted role (needs DATABASE_URL_OWNER + APP_DB_PASSWORD)
pnpm db:seed                    # demo data (use --reset to wipe and reseed)
pnpm db:seed:bulk               # optional: lots more demo data for every page and role
pnpm dev
```

### Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Runtime connection as `gt_app` (on Neon use the **pooled** host) |
| `DATABASE_URL_OWNER` | Owner connection for migrations and seeding only (on Neon use the **direct** host) |
| `APP_DB_PASSWORD` | Password assigned to `gt_app` by `pnpm db:roles` |
| `APP_URL` | Public base URL for QR codes and invitation/reset links (falls back to `VERCEL_PROJECT_PRODUCTION_URL`) |
| `CRON_SECRET` | Authorises `/api/cron/refresh-status` (Vercel Cron sends it automatically) |
| `RESEND_API_KEY`, `EMAIL_FROM` | Optional email delivery. Without them, invitation links are shown to admins and reset links are logged. |
| `SEED_DEMO_PASSWORD`, `SEED_SUPER_ADMIN_EMAIL` | Demo seed credentials |

## Demo data

The seed creates the **Gear Tractor** organization (Alberta timezone) and a second tenant, **Tegnol**, which shows tenant isolation and branding:

* Locations: Main Warehouse, Workshop, Training Yard, Field Storage, Lock-Up A
* Components: chainsaws, helmets, harnesses, ropes, carabiners, chaps, ear defenders, first-aid kits
* Configurations: Chainsaw Setup, Rope Access Setup, Climbing Setup
* Kits: Field Kit, Emergency Kit, Training Kit (contains a Configuration and a nested Kit)
* Consumables: fuel, oil, tape, accessory rope and cleaning supplies, three of them below reorder threshold
* Records with every status: an expired helmet, an overdue carabiner, a flagged harness, a missing carabiner, a rejected rope and an item with missing expiry information
* Two active sessions (including "Corporate Gala – TechCorp" at Lock-Up A, one of them overdue), one in-progress checkout (Step 2 of 4), reservations, inspection history and a returned checkout

### Bulk demo data

`pnpm db:seed:bulk` (also run automatically on deploy, once) adds a realistic history on top of the base seed so every page and role has plenty to look at: 13 users and 8 locations at Gear Tractor, about 250 inventory records, 12 Configurations, 6 Kits, 30 Consumables, around 50 returned checkouts with damage reports, 16 active sessions (some overdue or partially returned), drafts at every step, 24 reservations, inspection history, photos and PDF attachments, plus two more tenants: **Summit Arborists** and **Northwind Rescue** (inactive). It is additive and skips itself if it has already run.

### Demo accounts

| Password | Where |
| --- | --- |
| `GearTractor-Demo-2026` | Production (https://geartractor.vercel.app) |
| `GearTractor!2026` | Local (`.env` `SEED_DEMO_PASSWORD`) |

Every account below uses the same password. Change `SEED_DEMO_PASSWORD` before seeding a real environment.

| Organization | Role | Accounts |
| --- | --- | --- |
| Platform | Super Admin | `super@geartractor.app` |
| Gear Tractor | Organization Admin | `dj@geartractor.app` (DJ Fernandez), `priya@geartractor.app` (Priya Nair) |
| Gear Tractor | Trainer | `sam@`, `maya@`, `liam@`, `aisha@`, `noah@`, `chloe@`, `ethan@`, `zara@geartractor.app` |
| Gear Tractor | Invited / deactivated | `jordan@`, `owen@geartractor.app` (invited, no password yet), `grace@geartractor.app` (deactivated, cannot sign in) |
| Tegnol | Organization Admin | `admin@tegnol.agency` (Talha S.), `hira@tegnol.agency` |
| Tegnol | Trainer | `bilal@`, `sana@`, `usman@tegnol.agency` (`ayesha@tegnol.agency` is invited) |
| Summit Arborists | Organization Admin | `marcus@summitarborists.ca` |
| Summit Arborists | Trainer | `elena@`, `ravi@summitarborists.ca` |
| Northwind Rescue | Organization Admin | `fiona@northwindrescue.co.uk` (organization is inactive, so sign-in is blocked) |

## Quality checks

```bash
pnpm typecheck   # next typegen + tsc
pnpm lint
pnpm test        # Vitest: unit + integration against a real Postgres test database (.env.test)
pnpm build
```

The integration suite (`tests/integration`) covers:

* tenant isolation, including RLS without WHERE clauses, blocked cross-tenant writes and relations, and the runtime role being unable to bypass RLS
* inventory CRUD and codes
* the single-parent rule, type, location and status rules, and circular kit prevention
* allocation, including over, duplicate and negative quantities and no double reservation for nested configurations
* status propagation and inspection rules (pass does not override Missing, Rejected or expiry; exceptions need a note)
* checkout blocking messages and assembly expansion
* **concurrent checkout** and concurrent consumable issue
* partial returns and consumable accounting
* reservations: overlap, concurrent booking, override and fulfilment
* auth: rate limiting, single-use reset tokens, invitation and first-time password, organization deactivation
* attachments: chunked upload, type and size validation, magic-byte check, tenant privacy

## Deployment (Vercel + Neon)

`vercel.json` runs `pnpm db:deploy && pnpm build`. That applies migrations, provisions `gt_app` and seeds demo data once (the seed skips when data exists). It also schedules the daily status refresh cron. Set the environment variables above in the Vercel project. Set `SEED_ON_DEPLOY=false` to disable seeding.

## Security notes

* Passwords are hashed with bcrypt (cost 12). Session tokens are random 256-bit values stored as SHA-256 hashes. Cookies are httpOnly, `SameSite=Lax` and Secure in production.
* Rate limits are stored in Postgres, so they work across serverless instances. They cover login, password reset and password change.
* All input is validated with Zod. Errors shown to users are always human-readable, and raw technical errors are never displayed.
* Attachments (JPG/PDF, at most 10MB) are uploaded in chunks, validated by magic bytes and served only through an authorised route with `nosniff` and a sandbox CSP.
* CSV exports are UTF-8 with a BOM, use YYYY-MM-DD dates and are protected against formula injection.
