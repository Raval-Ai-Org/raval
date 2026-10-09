import { z } from "zod";
import { createHash, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { after } from "next/server";
import { consumeRateLimit } from "@/server/rate-limit";
import { assetPathsFromMeta, mediaKind } from "@/lib/shares/snapshot";
import { workspacePath } from "@/lib/workspace/paths";

export const dynamic = "force-dynamic";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const EventSchema = z.object({
  token: z.string().min(8).max(128),
  kind: z.enum(["viewed", "commented", "approved", "requested_changes", "rejected", "suggested"]),
  itemId: z.string().uuid().nullish(),
  body: z.string().max(4000).optional(),
  actorName: z.string().max(120).optional(),
  actorEmail: z.string().email().max(254).optional(),
  password: z.string().max(200).optional(),
});

function sha256(s: string) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function tokenMatches(provided: string, stored: string): boolean {
  const a = Buffer.from(sha256(provided));
  const b = Buffer.from(stored);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Verify a share password.
 *
 * Async scrypt, not scryptSync: this endpoint is unauthenticated, and Node's
 * default scrypt cost blocks the event loop for ~50-100ms per call. A handful
 * of concurrent requests against a password-protected slug would stall every
 * other request in the process. The async form runs on the threadpool.
 */
async function verifyPassword(
  provided: string | undefined,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return true;
  if (!provided) return false;
  // Format: scrypt$<saltHex>$<keyHex>
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  try {
    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    const actual = await scryptAsync(provided, salt, expected.length);
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * Throttle password attempts. Two budgets:
 *   • per (slug, client IP) — 10 / 5 min: stops a single brute-forcer without
 *     locking the real client out of their own share;
 *   • per slug, 5× that — caps a distributed attempt set on one share.
 * Each attempt also costs a scrypt derivation. Fails open like every other
 * limiter call (src/server/rate-limit.ts).
 */
async function tooManyPasswordAttempts(slug: string, request: Request): Promise<boolean> {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const ipKey = createHash("sha256").update(ip).digest("hex").slice(0, 24);
  const perClient = await consumeRateLimit("share-password", `${slug}:${ipKey}`);
  if (!perClient.ok) return true;
  const perSlug = await consumeRateLimit("share-password-link", `${slug}:all`);
  return !perSlug.ok;
}

function hasAssetPaths(snapshot: unknown): snapshot is { asset_paths: unknown[] } {
  return (
    !!snapshot &&
    typeof snapshot === "object" &&
    Array.isArray((snapshot as { asset_paths?: unknown }).asset_paths)
  );
}

function clientKey(request: Request): string {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return createHash("sha256").update(ip).digest("hex").slice(0, 24);
}

/**
 * Tell the person who made the share that their client answered. At most one
 * email per share per hour, decided from the stored thread; never throws.
 */
async function notifyTeam(share: {
  id: string;
  title: string;
  owner_id: string;
  workspace_id: string;
}): Promise<void> {
  try {
    const { emailConfigured, sendEmail, appUrl } = await import("@/server/notify/email.server");
    if (!emailConfigured()) return;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await supabaseAdmin
      .from("client_events")
      .select("id", { count: "exact", head: true })
      .eq("share_id", share.id)
      .eq("actor_type", "client")
      .neq("kind", "viewed")
      .gte("created_at", since);
    // This message is already stored, so more than one means we wrote recently.
    if ((count ?? 0) > 1) return;
    const { data: owner } = await supabaseAdmin.auth.admin.getUserById(share.owner_id);
    const to = owner?.user?.email;
    if (!to) return;
    await sendEmail({
      to,
      subject: `Your client replied: ${share.title}`,
      text: "Your client left feedback on the work you shared. Open the client portal to read it and answer.",
      action: ["Open Mellox", appUrl(workspacePath(share.workspace_id))],
    });
  } catch (cause) {
    console.error("[shares] team notice failed", cause instanceof Error ? cause.message : cause);
  }
}

function json(status: number, payload: unknown, extraHeaders?: Record<string, string>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      // Client-share responses may contain review content, comments, and
      // approval state; do not let intermediaries cache them.
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...(extraHeaders ?? {}),
    },
  });
}

export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const params = await ctx.params;
  const url = new URL(request.url);
  const token = url.searchParams.get("t") ?? "";
  // Password MUST be sent via header, never in the query string
  // (query params leak into server logs, referer headers, and browser history).
  const password = request.headers.get("x-share-password") ?? undefined;
  if (!token) return json(401, { error: "Missing token" });

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: share, error } = await supabaseAdmin
    .from("client_shares")
    .select(
      "id, title, slug, token_hash, client_name, client_email, password_hash, expires_at, allow_comments, allow_approvals, allow_download, branding, status, workspace_id, view_count",
    )
    .eq("slug", params.slug)
    .maybeSingle();

  // Same answer for "no such share" and "wrong token": a slug alone reveals nothing.
  if (error || !share || !tokenMatches(token, (share as any).token_hash))
    return json(404, { error: "Not found" });
  if ((share as any).status !== "active") return new Response("Gone", { status: 410 });
  if ((share as any).expires_at && new Date((share as any).expires_at).getTime() < Date.now())
    return new Response("Expired", { status: 410 });

  const passwordRequired = !!(share as any).password_hash;

  // If a password is set, require it before returning items or tracking a view.
  if (passwordRequired) {
    if (!password) {
      return json(200, {
        share: {
          id: (share as any).id,
          title: (share as any).title,
          passwordRequired: true,
        },
        items: [],
        locked: true,
      });
    }
    if (await tooManyPasswordAttempts(params.slug, request)) {
      return json(
        429,
        { error: "Too many password attempts. Try again shortly.", locked: true },
        {
          "Retry-After": "300",
        },
      );
    }
    if (!(await verifyPassword(password, (share as any).password_hash))) {
      return json(401, { error: "Invalid password", passwordRequired: true, locked: true });
    }
  }

  // Fetch workspace branding fallback
  const { data: ws } = await supabaseAdmin
    .from("workspaces")
    .select("name")
    .eq("id", (share as any).workspace_id)
    .maybeSingle();

  const { data: items } = await supabaseAdmin
    .from("client_share_items")
    .select("id, kind, ref_id, title, description, position, snapshot, visible")
    .eq("share_id", (share as any).id)
    .eq("visible", true)
    .order("position", { ascending: true });

  // Experiment reports are rendered now, from server-owned rows of this
  // share's own workspace (buildReport refuses any other workspace).
  const shareItems = (items ?? []) as Array<{
    kind: string;
    ref_id: string | null;
    snapshot: unknown;
  }>;
  if (shareItems.some((i) => i.kind === "experiment_report")) {
    const { isProofEngineEnabled } = await import("@/lib/feature-flags");
    const enabled = isProofEngineEnabled((share as any).workspace_id);
    const { buildReport } = enabled
      ? await import("@/server/experiments/report.server")
      : { buildReport: null };
    for (const item of shareItems) {
      if (item.kind !== "experiment_report") continue;
      item.snapshot =
        buildReport && item.ref_id
          ? ((await buildReport(item.ref_id, (share as any).workspace_id).catch(() => null)) ?? {
              unavailable: true,
            })
          : { unavailable: true };
    }
  }

  // Pictures and video are stored privately; the page gets short-lived links,
  // made now. The paths come from member-editable rows, so each one is checked
  // against this share's own workspace before it is signed.
  const workspaceId = String((share as any).workspace_id);
  const liveRefs = shareItems
    .filter((i) => i.kind === "content_item" && i.ref_id && !hasAssetPaths(i.snapshot))
    .map((i) => i.ref_id as string);
  const liveMeta = new Map<string, unknown>();
  if (liveRefs.length) {
    // Shares made before snapshots kept their media: read it from the post.
    const { data: posts } = await supabaseAdmin
      .from("content_items")
      .select("id, meta")
      .eq("workspace_id", workspaceId)
      .in("id", liveRefs);
    for (const post of posts ?? []) liveMeta.set(String(post.id), post.meta);
  }
  const { signAssetPath } = await import("@/server/assets/persist.server");
  for (const item of shareItems) {
    if (item.kind !== "content_item") continue;
    const snapshot = (item.snapshot ?? {}) as Record<string, unknown>;
    const paths = hasAssetPaths(snapshot)
      ? assetPathsFromMeta({ asset_storage_paths: snapshot.asset_paths }, workspaceId)
      : assetPathsFromMeta(item.ref_id ? liveMeta.get(item.ref_id) : null, workspaceId);
    const media: Array<{ url: string; kind: "image" | "video" }> = [];
    for (const path of paths) {
      const signed = await signAssetPath(path);
      if (signed) media.push({ url: signed, kind: mediaKind(path) });
    }
    const { asset_paths: _paths, ...rest } = snapshot;
    item.snapshot = { ...rest, media };
  }

  const { data: events } = await supabaseAdmin
    .from("client_events")
    // No emails and no view pings: anyone holding the link sees this thread.
    .select("id, item_id, kind, body, actor_name, actor_type, marketer_decision, created_at")
    .eq("share_id", (share as any).id)
    .neq("kind", "viewed")
    .order("created_at", { ascending: false })
    .limit(200);
  // Newest 200, shown oldest first.
  const thread = (events ?? []).slice().reverse();

  await supabaseAdmin
    .from("client_events")
    .update({ client_read_at: new Date().toISOString() })
    .eq("share_id", (share as any).id)
    .eq("actor_type", "team")
    .is("client_read_at", null);

  // Count a view on page load only; the page's background refresh sends
  // ?refresh=1 so an open tab does not inflate the count.
  if (url.searchParams.get("refresh") !== "1") {
    await supabaseAdmin
      .from("client_shares")
      .update({
        last_viewed_at: new Date().toISOString(),
        view_count: ((share as any).view_count ?? 0) + 1,
      })
      .eq("id", (share as any).id);
  }

  return json(200, {
    share: {
      id: (share as any).id,
      title: (share as any).title,
      clientName: (share as any).client_name,
      clientEmail: (share as any).client_email,
      allowComments: (share as any).allow_comments,
      allowApprovals: (share as any).allow_approvals,
      allowDownload: (share as any).allow_download,
      branding: (share as any).branding ?? {},
      expiresAt: (share as any).expires_at,
      workspaceName: ws?.name ?? "Workspace",
      passwordRequired,
    },
    items: items ?? [],
    events: thread,
  });
}

export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const params = await ctx.params;
  let body: z.infer<typeof EventSchema>;
  try {
    body = EventSchema.parse(await request.json());
  } catch {
    return json(400, { error: "Invalid body" });
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: share } = await supabaseAdmin
    .from("client_shares")
    .select(
      "id, title, owner_id, workspace_id, token_hash, password_hash, status, expires_at, allow_comments, allow_approvals",
    )
    .eq("slug", params.slug)
    .maybeSingle();
  if (!share || !tokenMatches(body.token, (share as any).token_hash))
    return json(404, { error: "Not found" });
  // Anyone holding the link can write here, so the thread is bounded per
  // visitor and per link.
  const perVisitor = await consumeRateLimit("share-event", `${params.slug}:${clientKey(request)}`);
  const perLink = perVisitor.ok
    ? await consumeRateLimit("share-event-link", `${params.slug}:all`)
    : perVisitor;
  if (!perLink.ok) {
    return json(
      429,
      { error: "Too many messages. Try again in a few minutes." },
      { "Retry-After": String(perLink.retryAfterSeconds || 300) },
    );
  }
  if ((share as any).status !== "active") return new Response("Gone", { status: 410 });
  if ((share as any).expires_at && new Date((share as any).expires_at).getTime() < Date.now())
    return new Response("Expired", { status: 410 });

  // Enforce password when set on the share.
  if ((share as any).password_hash) {
    if (await tooManyPasswordAttempts(params.slug, request)) {
      return json(
        429,
        { error: "Too many password attempts. Try again shortly." },
        {
          "Retry-After": "300",
        },
      );
    }
    if (!(await verifyPassword(body.password, (share as any).password_hash))) {
      return json(401, { error: "Password required", passwordRequired: true });
    }
  }

  // Permission gates
  if (body.kind === "commented" && !(share as any).allow_comments)
    return json(403, { error: "Comments disabled" });
  if (
    (body.kind === "approved" || body.kind === "rejected" || body.kind === "requested_changes") &&
    !(share as any).allow_approvals
  )
    return json(403, { error: "Approvals disabled" });

  // An event may only reference an item that belongs to THIS share — a share
  // link must not be usable to approve or comment on arbitrary content.
  if (body.itemId) {
    const { data: item } = await supabaseAdmin
      .from("client_share_items")
      .select("id")
      .eq("id", body.itemId)
      .eq("share_id", (share as any).id)
      .maybeSingle();
    if (!item) return json(404, { error: "Item not found" });
  }

  const { error: insErr } = await supabaseAdmin.from("client_events").insert({
    share_id: (share as any).id,
    item_id: body.itemId ?? null,
    kind: body.kind,
    body: body.body ?? null,
    actor_name: body.actorName ?? null,
    actor_email: body.actorEmail ?? null,
    actor_type: "client",
    meta: {},
  });
  if (insErr) return json(500, { error: "Couldn't save that. Try again." });
  if (body.kind !== "viewed") {
    after(() =>
      notifyTeam({
        id: String((share as any).id),
        title: String((share as any).title ?? "Shared work"),
        owner_id: String((share as any).owner_id),
        workspace_id: String((share as any).workspace_id),
      }),
    );
  }
  return json(200, { ok: true });
}
