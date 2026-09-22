import { defineConfig } from "vitest/config";
import path from "path";

const resolve = {
  // import.meta.dirname (not __dirname) — Vite's native config loader warns
  // on CJS globals and will drop support for them in a future major.
  alias: {
    "@": path.resolve(import.meta.dirname, "./src"),
    "server-only": path.resolve(import.meta.dirname, "./tests/fixtures/empty-module.ts"),
  },
};

// Server-side defaults so modules that read process.env don't crash on
// undefined. SDR_BASE_URL is overridden at runtime by the MockSDR fixture
// (tests/fixtures/mock-sdr.ts) with an ephemeral port.
const env = {
  SDR_BASE_URL: "http://127.0.0.1:0",
  SDR_ADMIN_TOKEN: "test-admin-token-for-vitest",
  SUPABASE_URL: "https://placeholder.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
};

export default defineConfig({
  resolve,
  test: {
    env,
    projects: [
      {
        resolve,
        test: {
          name: "unit",
          environment: "node",
          env,
          include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
          exclude: ["tests/db/**"],
        },
      },
      {
        resolve,
        test: {
          name: "db",
          environment: "node",
          env,
          include: ["tests/db/**/*.test.ts"],
          // Each of these replays the whole migration history into its own
          // in-process Postgres (PGlite/WASM). Run them one file at a time:
          // several at once exhausts the WebAssembly array buffer, and the
          // failure looks like a schema bug rather than the memory limit it is.
          fileParallelism: false,
        },
      },
    ],
  },
});
