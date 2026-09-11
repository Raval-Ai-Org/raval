import { z } from "zod";
import { createHash, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { consumeRateLimit } from "@/server/rate-limit";

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
  const perSlug = await consumeRateLimit("share-password", `${slug}:all`, { cost: 0.2 });
  return !perSlug.ok;
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

  // Fire-and-forget view track
  await supabaseAdmin
    .from("client_shares")
    .update({
      last_viewed_at: new Date().toISOString(),
      view_count: ((share as any).view_count ?? 0) + 1,
    })
    .eq("id", (share as any).id);

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
    .select("id, token_hash, password_hash, status, expires_at, allow_comments, allow_approvals")
    .eq("slug", params.slug)
    .maybeSingle();
  if (!share || !tokenMatches(body.token, (share as any).token_hash))
    return json(404, { error: "Not found" });
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
    meta: {},
  });
  if (insErr) return json(500, { error: insErr.message });
  return json(200, { ok: true });
}
