// Meta calls this when a person removes Mellox in their Facebook settings
// (Settings → Apps and websites → Remove). The body is a signed_request; one
// that doesn't verify with the app secret is refused. Mellox then deletes what
// it holds from that person's connections (deletion.server.ts).
import { metaConfig } from "@/server/engage/meta/config.server";
import { forgetMetaUser } from "@/server/engage/meta/deletion.server";
import { parseSignedRequest } from "@/lib/engage/meta-signed";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let appSecret: string;
  try {
    appSecret = metaConfig().appSecret;
  } catch {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }
  const form = await request.formData().catch(() => null);
  const signed = form?.get("signed_request");
  const payload = typeof signed === "string" ? parseSignedRequest(signed, appSecret) : null;
  if (!payload) return Response.json({ error: "invalid_signed_request" }, { status: 400 });
  try {
    await forgetMetaUser(payload.userId, "deauthorized");
  } catch (error) {
    console.error(
      "[engage] Meta deauthorize failed",
      error instanceof Error ? error.message : error,
    );
    return Response.json({ error: "failed" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
