// Live check of the GitHub connect return path against the real database:
// install state issuance with a return origin, the callback route handing the
// installer back to that origin, and states that survive a failed completion.
// No GitHub installation is created or changed; the state rows it creates are
// deleted. Opt-in:
//   npx vitest run --config vitest.live.config.ts tests/live/github-connect.live.ts
import { afterAll, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const describeLive =
  process.env.GITHUB_APP_ID && process.env.SUPABASE_SERVICE_ROLE_KEY ? describe : describe.skip;

describeLive("GitHub connect return path (live)", () => {
  const created: string[] = [];

  afterAll(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (created.length) {
      await supabaseAdmin.from("connector_install_states").delete().in("id", created);
    }
  });

  async function owner() {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("workspace_members")
      .select("workspace_id, user_id")
      .eq("role", "owner")
      .limit(1)
      .single();
    expect(error, error?.message).toBeNull();
    return { workspaceId: data!.workspace_id as string, userId: data!.user_id as string };
  }

  async function issue(returnOrigin: string | null) {
    const { createInstallUrl, readInstallState } =
      await import("@/server/connectors/github/service.server");
    const who = await owner();
    const { url } = await createInstallUrl({ ...who, returnOrigin });
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://github.com");
    expect(parsed.pathname).toBe(`/apps/${process.env.GITHUB_APP_SLUG}/installations/new`);
    const state = parsed.searchParams.get("state")!;
    const row = await readInstallState(state, who.userId);
    created.push(row.id);
    return { state, row, who };
  }

  it("hands the installer back to the origin that started the flow", async () => {
    const { state } = await issue("http://localhost:8080");
    const { GET } = await import("@/app/api/integrations/github/callback/route");
    const res = await GET(
      new Request(
        `https://mellox.ai/api/integrations/github/callback?installation_id=161745638&setup_action=install&state=${state}&code=abc`,
      ),
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("location")!;
    console.info(`[live] callback relay -> ${location.replace(state, "<state>").replace("abc", "<code>")}`);
    expect(location.startsWith("http://localhost:8080/integrations/github/callback?")).toBe(true);
    const forwarded = new URL(location).searchParams;
    expect(forwarded.get("state")).toBe(state);
    expect(forwarded.get("installation_id")).toBe("161745638");
    expect(forwarded.get("code")).toBe("abc");
  });

  it("stays on the current origin for unknown states and unlisted origins", async () => {
    const { GET } = await import("@/app/api/integrations/github/callback/route");
    const unknown = await GET(
      new Request(
        "https://mellox.ai/api/integrations/github/callback?installation_id=1&state=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      ),
    );
    expect(unknown.headers.get("location")!.startsWith("/integrations/github/callback?")).toBe(true);

    const { state } = await issue("https://evil.example");
    const foreign = await GET(
      new Request(`https://mellox.ai/api/integrations/github/callback?installation_id=1&state=${state}`),
    );
    expect(foreign.headers.get("location")!.startsWith("/integrations/github/callback?")).toBe(true);
  });

  it("keeps a state usable after a failed completion and binds it to its user", async () => {
    const { linkInstallation, readInstallState, markInstallStateUsed, findConnectionFromState } =
      await import("@/server/connectors/github/service.server");
    const { state, row, who } = await issue(null);

    // OAuth mode without a code fails before anything is saved…
    await expect(
      linkInstallation({ state: row, installationId: "161745638", code: null }),
    ).rejects.toThrow(/authorization code/i);
    // …and the state is still there to retry.
    const again = await readInstallState(state, who.userId);
    expect(again.consumedAt).toBeNull();

    await expect(
      readInstallState(state, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow(/different Mellox user/);

    await markInstallStateUsed(again);
    const used = await readInstallState(state, who.userId);
    expect(used.consumedAt).not.toBeNull();
    // No connection was saved from it, so a resubmit has nothing to return.
    expect(await findConnectionFromState(used, "161745638")).toBeNull();
  });
});
