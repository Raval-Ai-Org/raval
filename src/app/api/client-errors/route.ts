// POST /api/client-errors — browser error boundaries report here so front-end
// crashes reach the same error tracker as server errors. Unauthenticated (an
// error page may render signed-out) but tightly bounded: small body, schema,
// and a per-IP rate limit. Never echoes anything back.
import { z } from "zod";
import { createHash } from "node:crypto";
import { consumeRateLimit } from "@/server/rate-limit";
import { reportError } from "@/server/observability/errors";

export const dynamic = "force-dynamic";

const Body = z.object({
  message: z.string().max(1000),
  digest: z.string().max(200).optional(),
  path: z.string().max(500).optional(),
  stack: z.string().max(4000).optional(),
});

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const subject = createHash("sha256").update(ip).digest("hex").slice(0, 24);
  const limit = await consumeRateLimit("share-password", `client-error:${subject}`);
  if (!limit.ok) return new Response(null, { status: 204 });

  const raw = await request.text();
  if (raw.length > 8000) return new Response(null, { status: 413 });
  let parsed;
  try {
    parsed = Body.safeParse(JSON.parse(raw));
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!parsed.success) return new Response(null, { status: 400 });

  const err = new Error(parsed.data.message);
  err.name = "ClientError";
  if (parsed.data.stack) err.stack = parsed.data.stack;
  reportError(err, { source: "client", extra: { digest: parsed.data.digest, path: parsed.data.path } });
  return new Response(null, { status: 204 });
}
