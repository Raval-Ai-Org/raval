import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
// @ts-expect-error plain .mjs helper shared with the migration verifier
import { createMigratedDb, readMigration } from "../../scripts/db/pglite-supabase.mjs";

const migration = readMigration("20261016090000_repair_slack_claims_and_experiments_schedule.sql");
let db: PGlite;

beforeAll(async () => {
  db = await createMigratedDb();
}, 120_000);
afterAll(async () => db?.close());

describe("experiments schedule repair", () => {
  it("schedules a missing job once Vault is configured and preserves an existing schedule", async () => {
    await db.query("select vault.create_secret('https://example.invalid', 'mellox_app_base_url')");
    await db.query(
      "select vault.create_secret('test-secret-at-least-16-chars', 'mellox_cron_secret')",
    );
    await db.exec(migration);
    const first = await db.query<{ jobname: string; schedule: string; command: string }>(
      "select jobname,schedule,command from cron.job where jobname='mellox-experiments'",
    );
    expect(first.rows).toEqual([
      expect.objectContaining({
        jobname: "mellox-experiments",
        schedule: "*/5 * * * *",
        command: "SELECT public.call_app_hook('/api/public/hooks/experiments');",
      }),
    ]);

    await db.query(
      "update cron.job set schedule='*/10 * * * *' where jobname='mellox-experiments'",
    );
    await db.exec(migration);
    const existing = await db.query<{ schedule: string }>(
      "select schedule from cron.job where jobname='mellox-experiments'",
    );
    expect(existing.rows).toEqual([{ schedule: "*/10 * * * *" }]);
  });
});
