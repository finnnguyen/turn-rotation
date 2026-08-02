import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(projectRoot, "src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    // Integration tests need a live local Supabase stack (`supabase start`)
    // and run separately via `npm run test:integration` /
    // vitest.integration.config.ts — excluded here so the default `npm run
    // test` (what CI's quality job runs, without Supabase running) doesn't
    // fail trying to reach a database that isn't there.
    exclude: ["node_modules/**", "tests/integration/**"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
