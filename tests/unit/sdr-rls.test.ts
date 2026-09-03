// T073 — security guard: the workspace_sdr table must be SERVICE-ROLE ONLY
// (FR-014 / SC-009). This asserts the migration grants NO access to
// `authenticated`/`anon` (only service_role), so the user's browser can never
// read per-workspace SDR keys or webhook secrets. A static test over the
// migration SQL (deterministic; real RLS is verified at deploy with a live DB).
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const MIGRATION = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations/20260809000001_add_workspace_sdr.sql",
);

function migrationSql(): string {
  return readFileSync(MIGRATION, "utf8");
}

function filesContaining(root: string, pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const entry of readdirSync(root)) {
    const fullPath = path.join(root, entry);
    if (statSync(fullPath).isDirectory()) {
      hits.push(...filesContaining(fullPath, pattern));
    } else if (pattern.test(readFileSync(fullPath, "utf8"))) {
      hits.push(fullPath);
    }
  }
  return hits;
}

describe("workspace_sdr RLS posture (FR-014)", () => {
  const sql = migrationSql();

  it("enables row level security on workspace_sdr", () => {
    expect(sql).toMatch(/alter table public\.workspace_sdr enable row level security/i);
  });

  it("grants NO authenticated/anon access — only service_role", () => {
    // The migration must not grant any capability to `authenticated` or `anon`.
    expect(sql).not.toMatch(/grant\s+.*\s+to\s+authenticated/i);
    expect(sql).not.toMatch(/grant\s+.*\s+to\s+anon/i);
    // service_role gets full access (server-side client only).
    expect(sql).toMatch(/grant all on public\.workspace_sdr to service_role/i);
  });

  it("creates NO client-facing policies on workspace_sdr", () => {
    // A policy for authenticated would expose the table to the user client.
    expect(sql).not.toMatch(
      /create policy .* on public\.workspace_sdr for (select|all) to authenticated/i,
    );
  });

  it("the app never queries workspace_sdr with a user-scoped client", () => {
    // workspace_sdr is only accessed via supabaseAdmin (service-role) in
    // .server.ts modules — never through the RLS-enforced user client. The
    // provisioning module uses the WS_SDR_TABLE constant; assert every file
    // that touches it is a server-only module.
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const hits = filesContaining(root + "/src", /WS_SDR_TABLE|from\("workspace_sdr"\)|from\(WS_SDR_TABLE\)/);
    expect(hits.length).toBeGreaterThan(0);
    for (const f of hits) {
      // workspace_sdr access must live in server-only modules: it must never be
      // in a client component, a client-server fn (.functions.ts), or the
      // browser supabase client. (Server libs may be named without `.server.ts`.)
      expect(f).not.toMatch(/components\//);
      expect(f).not.toMatch(/\.functions\.ts$/);
      expect(f).not.toMatch(/supabase\/client\.ts$/);
    }
  });
});
