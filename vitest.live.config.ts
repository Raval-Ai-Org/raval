// vitest.live.config.ts — opt-in live checks against the real Supabase project
// and the real SocialAPI.ai account (reads .env). Never part of `npm test`:
//   npx vitest run --config vitest.live.config.ts
// They create no posts and use no publishing credits.
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "server-only": path.resolve(import.meta.dirname, "./tests/fixtures/empty-module.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/live/**/*.live.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
