// Live check of Inbox DMs against the real Supabase project and Meta (reads
// .env). For a workspace with Meta connected, it runs the real sweep:
//
//   reading: Messenger (and Instagram, when linked) conversations become DM
//   rows, one per conversation the person wrote last, within Meta's 24 hours
//   answering (ENGAGE_LIVE_REPLY=yes): Mox decides on each new DM and comment
//   exactly as the run-schedules hook does, and may SEND a reply on Meta
//
// Reading is free. Answering makes one small model call per new message and
// sends real replies from the brand's Page, so it is opt-in.
//   ENGAGE_LIVE_WORKSPACE=<id> npx vitest run --config vitest.live.config.ts tests/live/engage-dm.live.ts
import { describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const WS = process.env.ENGAGE_LIVE_WORKSPACE ?? "";
const describeLive = process.env.SUPABASE_SERVICE_ROLE_KEY && WS ? describe : describe.skip;

describeLive("Inbox DMs (live)", () => {
  it("reads the Page's conversations into DM rows", async () => {
    const { syncEngage } = await import("@/server/engage/service.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const result = await syncEngage(WS);
    console.log("sync", JSON.stringify(result));
    const { data, error } = await supabaseAdmin
      .from("engage_comments")
      .select("id,kind,platform,author_name,body,status,mox_state,commented_at")
      .eq("workspace_id", WS)
      .eq("kind", "dm")
      .order("commented_at", { ascending: false })
      .limit(5);
    expect(error).toBeNull();
    console.log("dm rows", JSON.stringify(data, null, 1));
  }, 120_000);

  it.runIf(process.env.ENGAGE_LIVE_REPLY === "yes")(
    "lets Mox answer what waits",
    async () => {
      const { runAutoReply } = await import("@/server/engage/auto-reply.server");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const out = await runAutoReply(WS);
      console.log("auto-reply", JSON.stringify(out));
      const { data } = await supabaseAdmin
        .from("engage_comments")
        .select("kind,platform,body,status,reply_text,mox_state,mox_note,last_error")
        .eq("workspace_id", WS)
        .eq("kind", "dm")
        .order("commented_at", { ascending: false })
        .limit(3);
      console.log("after", JSON.stringify(data, null, 1));
    },
    180_000,
  );
});
