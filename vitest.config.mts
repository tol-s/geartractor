import { defineConfig } from "vitest/config";
import path from "node:path";
import { config } from "dotenv";

const env = config({ path: ".env.test" }).parsed ?? {};

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    env,
    globalSetup: ["tests/global-setup.ts"],
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
