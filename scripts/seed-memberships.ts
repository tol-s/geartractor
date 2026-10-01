import "dotenv/config";
import { Pool } from "pg";

/**
 * Demo memberships: gives a few demo accounts access to more than one organization so the
 * organization switcher has something to show. Idempotent and additive.
 */
const MEMBERSHIPS: { email: string; org: string; role: "org_admin" | "trainer" }[] = [
  { email: "dj@geartractor.app", org: "Tegnol", role: "org_admin" },
  { email: "dj@geartractor.app", org: "Summit Arborists", role: "trainer" },
  { email: "admin@tegnol.agency", org: "Gear Tractor", role: "org_admin" },
  { email: "admin@tegnol.agency", org: "Summit Arborists", role: "org_admin" },
  { email: "sam@geartractor.app", org: "Summit Arborists", role: "trainer" },
  { email: "priya@geartractor.app", org: "Tegnol", role: "trainer" },
  { email: "marcus@summitarborists.ca", org: "Gear Tractor", role: "trainer" },
];

async function main() {
  const url = process.env.DATABASE_URL_OWNER ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_OWNER is not set");
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  let added = 0;
  try {
    await client.query("begin");
    await client.query("select set_config('app.bypass', 'on', true)");
    for (const m of MEMBERSHIPS) {
      const res = await client.query(
        `insert into organization_members (organization_id, user_id, role)
         select o.id, u.id, $3::user_role from organizations o, users u
         where o.name = $2 and lower(u.email) = lower($1) and u.organization_id is distinct from o.id
         on conflict (organization_id, user_id) do nothing`,
        [m.email, m.org, m.role],
      );
      added += res.rowCount ?? 0;
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
  console.log(`Demo memberships: ${added} added`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
