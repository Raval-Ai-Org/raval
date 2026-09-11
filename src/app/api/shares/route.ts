import { z } from "zod";
import { createHash, randomBytes } from "crypto";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  workspaceId: z.string().uuid(),
  title: z.string().min(1).max(200),
  clientName: z.string().max(120).optional(),
  clientEmail: z.string().email().max(254).optional().nullable(),
  password: z.string().min(4).max(200).optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
  allowComments: z.boolean().default(true),
  allowApprovals: z.boolean().default(true),
  allowDownload: z.boolean().default(false),
  branding: z.record(z.any()).optional(),
  items: z
    .array(
      z.object({
        kind: z.enum(["content_item", "audit", "brand_dna", "calendar", "note"]),
        refId: z.string().uuid().optional().nullable(),
        title: z.string().max(200).optional(),
        description: z.string().max(1000).optional(),
        snapshot: z.record(z.any()).optional(),
      }),
    )
    .min(1)
    .max(50),
});

const DecideSchema = z.object({
  eventId: z.string().uuid(),
  decision: z.enum(["accepted", "dismissed", "applied"]),
});

const RevokeSchema = z.object({ shareId: z.string().uuid() });

const ListSchema = z.object({ workspaceId: z.string().uuid() });

function sha256(s: string) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function makeSlug(): string {
  return (
    randomBytes(6)
      .toString("base64url")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 10) + Math.random().toString(36).slice(2, 6)
  );
}

function makeToken(): string {
  return randomBytes(24).toString("base64url");
}

async function bcryptHash(pw: string): Promise<string> {
  // Lightweight password hash using scrypt (Node built-in) — avoids extra deps.
  // Async form: the sync one blocks the event loop for ~50-100ms, which stalls
  // every concurrent request in the process. Verification in the public share
  // route is async for the same reason.
  const { scrypt } = await import("crypto");
  const { promisify } = await import("util");
  const scryptAsync = promisify(scrypt) as (
    password: string,
    salt: Buffer,
    keylen: number,
  ) => Promise<Buffer>;
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt, 32);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

// One endpoint, four actions (?action=list|revoke|decide|create). Bodies are
// parsed per action; a ZodError becomes a 400 in the route kernel.
export const POST = defineRoute({
  name: "shares",
  auth: "user",
  handler: async ({ request, userId, supabase }) => {
    const action = new URL(request.url).searchParams.get("action") ?? "create";

    if (action === "list") {
      const { workspaceId } = ListSchema.parse(await request.json());
      const { data: shares, error } = await supabase
        .from("client_shares")
        .select(
          "id, title, slug, client_name, client_email, allow_comments, allow_approvals, allow_download, expires_at, status, last_viewed_at, view_count, created_at",
        )
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false });
      if (error) return jsonError(500, error.message);

      const ids = (shares ?? []).map((s: any) => s.id);
      let events: any[] = [];
      if (ids.length) {
        const { data: ev } = await supabase
          .from("client_events")
          .select(
            "id, share_id, item_id, kind, body, actor_name, actor_email, marketer_decision, created_at",
          )
          .in("share_id", ids)
          .order("created_at", { ascending: false })
          .limit(200);
        events = ev ?? [];
      }
      return Response.json({ shares: shares ?? [], events });
    }

    if (action === "revoke") {
      const { shareId } = RevokeSchema.parse(await request.json());
      const { error } = await supabase
        .from("client_shares")
        .update({ status: "revoked" })
        .eq("id", shareId);
      if (error) return jsonError(500, error.message);
      return Response.json({ ok: true });
    }

    if (action === "decide") {
      const { eventId, decision } = DecideSchema.parse(await request.json());
      const { data: ev, error: evErr } = await supabase
        .from("client_events")
        .update({
          marketer_decision: decision,
          marketer_decided_at: new Date().toISOString(),
          marketer_decided_by: userId,
        })
        .eq("id", eventId)
        .select("id, share_id, item_id, kind, body")
        .single();
      if (evErr) return jsonError(500, evErr.message);

      // If client approved a content item and marketer accepts → flip its status to approved.
      if (decision === "accepted" && ev && (ev as any).kind === "approved" && (ev as any).item_id) {
        const { data: item } = await supabase
          .from("client_share_items")
          .select("ref_id, kind")
          .eq("id", (ev as any).item_id)
          .maybeSingle();
        if (item && (item as any).kind === "content_item" && (item as any).ref_id) {
          await supabase
            .from("content_items")
            .update({ status: "approved" })
            .eq("id", (item as any).ref_id);
        }
      }
      return Response.json({ ok: true, event: ev });
    }

    // Default: create
    const body = CreateSchema.parse(await request.json());

    const slug = makeSlug();
    const token = makeToken();
    const tokenHash = sha256(token);
    const passwordHash = body.password ? await bcryptHash(body.password) : null;

    const { data: share, error: shareErr } = await supabase
      .from("client_shares")
      .insert({
        workspace_id: body.workspaceId,
        owner_id: userId,
        title: body.title,
        slug,
        token_hash: tokenHash,
        client_name: body.clientName ?? null,
        client_email: body.clientEmail ?? null,
        password_hash: passwordHash,
        expires_at: body.expiresAt ?? null,
        allow_comments: body.allowComments,
        allow_approvals: body.allowApprovals,
        allow_download: body.allowDownload,
        branding: body.branding ?? {},
        status: "active",
      })
      .select("id, slug")
      .single();
    if (shareErr || !share) return jsonError(500, shareErr?.message ?? "create failed");

    const rows = body.items.map((it, i) => ({
      share_id: (share as any).id,
      kind: it.kind,
      ref_id: it.refId ?? null,
      title: it.title ?? null,
      description: it.description ?? null,
      position: i,
      snapshot: it.snapshot ?? {},
      visible: true,
    }));
    const { error: itemsErr } = await supabase.from("client_share_items").insert(rows);
    if (itemsErr) return jsonError(500, itemsErr.message);

    return Response.json({
      id: (share as any).id,
      slug,
      token,
      url: `${new URL(request.url).origin}/share/${slug}?t=${token}`,
    });
  },
});
