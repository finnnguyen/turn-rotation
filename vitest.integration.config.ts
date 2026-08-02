import { defineConfig } from "vitest/config";

// No React/jsdom needed — these call real RPC functions over HTTP against a
// local Supabase stack. Requires `supabase start` to be running first.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
