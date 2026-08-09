import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Server-side defaults so modules that read process.env don't crash on
    // undefined. SDR_BASE_URL is overridden at runtime by the MockSDR fixture
    // (tests/fixtures/mock-sdr.ts) with an ephemeral port.
    env: {
      SDR_BASE_URL: "http://127.0.0.1:0",
      SDR_ADMIN_TOKEN: "test-admin-token-for-vitest",
      SUPABASE_URL: "https://placeholder.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    },
  },
});
