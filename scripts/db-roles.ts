import "dotenv/config";
import { Pool } from "pg";

/**
 * Creates/updates the restricted runtime role `gt_app` used by the application.
 * The role has no BYPASSRLS attribute, so row-level security is always enforced.
 */
async function main() {
  const url = process.env.DATABASE_URL_OWNER;
  const password = process.env.APP_DB_PASSWORD;
  if (!url) throw new Error("DATABASE_URL_OWNER is not set");
  if (!password || password.length < 12) throw new Error("APP_DB_PASSWORD must be at least 12 characters");
  const pool = new Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  try {
    const exists = await client.query("select 1 from pg_roles where rolname = 'gt_app'");
    const quoted = password.replace(/'/g, "''");
    if (exists.rowCount === 0) {
      await client.query(`CREATE ROLE gt_app WITH LOGIN NOBYPASSRLS PASSWORD '${quoted}'`);
      console.log("Created role gt_app");
    } else {
      await client.query(`ALTER ROLE gt_app WITH LOGIN NOBYPASSRLS PASSWORD '${quoted}'`);
      console.log("Updated role gt_app");
    }
    const { rows } = await client.query("select current_database() as db");
    const dbName = rows[0].db as string;
    await client.query(`GRANT CONNECT ON DATABASE "${dbName}" TO gt_app`);
    await client.query("GRANT USAGE ON SCHEMA public TO gt_app");
    await client.query("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gt_app");
    await client.query("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gt_app");
    await client.query("GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO gt_app");
    await client.query("REVOKE ALL ON TABLE drizzle.__drizzle_migrations FROM gt_app").catch(() => {});
    await client.query(
      "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gt_app",
    );
    await client.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO gt_app");
    const check = await client.query(
      "select rolbypassrls, rolsuper from pg_roles where rolname = 'gt_app'",
    );
    console.log("gt_app privileges:", check.rows[0]);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
