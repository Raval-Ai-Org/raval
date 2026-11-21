// vitest.bench.config.ts — the free creative benchmark (tests/bench). Never
// part of `npm test`; it makes no network call and writes prompts to BENCH_OUT.
//   BENCH_LABEL=baseline BENCH_OUT=H:/MelloxResearch/bench npx vitest run --config vitest.bench.config.ts
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
    include: ["tests/bench/**/*.bench.ts"],
    env: {
      SUPABASE_URL: "https://placeholder.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
      OPENROUTER_API_KEY: "",
    },
  },
});
