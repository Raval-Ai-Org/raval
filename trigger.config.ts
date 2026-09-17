// trigger.config.ts — Trigger.dev CLI config (`npx trigger.dev dev|deploy`).
// Points at TRIGGER_API_URL for a self-hosted instance (unset = Trigger.dev
// Cloud, not used by this project — see docs/self-hosted-integrations.md).
// Application code never imports this file; only the CLI reads it.
import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF || "<set TRIGGER_PROJECT_REF>",
  dirs: ["./src/trigger"],
  // Per-task ceiling unless a task sets its own (competitor-intel-run: 300s).
  maxDuration: 300,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1_000,
      maxTimeoutInMs: 30_000,
      factor: 2,
      randomize: true,
    },
  },
});
