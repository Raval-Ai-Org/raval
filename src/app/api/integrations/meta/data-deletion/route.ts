// Meta's Data Deletion Request callback: a person asked Facebook to have
// Mellox delete their data. The body is a signed_request; one that doesn't
// verify with the app secret is refused. Mellox deletes at once
// (deletion.server.ts) and answers with the status page and a code the
// person can check there, as Meta requires.
import { metaConfig } from "@/server/engage/meta/config.server";
import { forgetMetaUser } from "@/server/engage/meta/deletion.server";
import { deletionCode, parseSignedRequest } from "@/lib/engage/meta-signed";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let config: ReturnType<typeof metaConfig>;
  try {
    config = metaConfig();
  } catch {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }
  const form = await request.formData().catch(() => null);
  const signed = form?.get("signed_request");
  const payload = typeof signed === "string" ? parseSignedRequest(signed, config.appSecret) : null;
  if (!payload) return Response.json({ error: "invalid_signed_request" }, { status: 400 });
  try {
    await forgetMetaUser(payload.userId, "data_deletion");
  } catch (error) {
    console.error(
      "[engage] Meta data deletion failed",
      error instanceof Error ? error.message : error,
    );
    return Response.json({ error: "failed" }, { status: 500 });
  }
  const code = deletionCode(Date.now(), config.appSecret);
  const origin = new URL(config.redirectUri).origin;
  return Response.json({
    url: `${origin}/data-deletion/status?code=${encodeURIComponent(code)}`,
    confirmation_code: code,
  });
}
