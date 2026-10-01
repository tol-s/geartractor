import "dotenv/config";
import { execSync } from "node:child_process";

/**
 * Runs during the Vercel build: applies migrations, provisions the RLS-restricted runtime role
 * and seeds demo data once (the seed refuses to run when data already exists).
 */
function run(cmd: string) {
  execSync(cmd, { stdio: "inherit", env: process.env });
}

if (!process.env.DATABASE_URL_OWNER) {
  console.warn("[db-deploy] DATABASE_URL_OWNER not set; skipping migrations.");
  process.exit(0);
}
run("tsx scripts/db-migrate.ts");
if (process.env.APP_DB_PASSWORD) run("tsx scripts/db-roles.ts");
if (process.env.SEED_DEMO_PASSWORD && process.env.SEED_ON_DEPLOY !== "false") {
  run("tsx scripts/seed.ts");
  // Additive, runs once: rich demo data for every page and role.
  run("tsx scripts/seed-bulk.ts");
}
