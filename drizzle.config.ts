import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Migrations run with the owner connection; the app runtime uses DATABASE_URL (RLS-enforced role).
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL_OWNER ?? process.env.DATABASE_URL ?? "",
  },
  strict: true,
});
