import { execSync } from "node:child_process";
import { config } from "dotenv";
import { Pool } from "pg";

/** Migrates the test database, provisions the RLS-restricted role and wipes all data. */
export default async function setup() {
  const env = config({ path: ".env.test" }).parsed ?? {};
  const opts = { env: { ...process.env, ...env }, stdio: "pipe" as const };
  execSync("npx tsx scripts/db-migrate.ts", opts);
  execSync("npx tsx scripts/db-roles.ts", opts);
  const owner = new Pool({ connectionString: env.DATABASE_URL_OWNER, max: 1 });
  const { rows } = await owner.query<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public'");
  await owner.query(`truncate ${rows.map((r) => `"${r.tablename}"`).join(", ")} cascade`);
  await owner.end();
}
