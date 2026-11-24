// A tracked link (Round 9): counts one click and sends the person on to the
// brand's own page. Link previews and crawlers are sent on without counting.
// The target was checked as the brand's own https page when the link was made.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isLinkBot } from "@/lib/links/tracked";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const home = new URL("/", request.url);
  if (!/^[A-Za-z0-9]{6,16}$/.test(slug)) return Response.redirect(home, 302);
  const bot = isLinkBot(request.headers.get("user-agent"));
  const { data } = await (
    supabaseAdmin as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }>;
    }
  ).rpc(bot ? "tracked_link_target" : "track_link_click", { p_slug: slug });
  const target = typeof data === "string" && data.startsWith("https://") ? data : null;
  if (!target) return Response.redirect(home, 302);
  return new Response(null, {
    status: 302,
    headers: {
      location: target,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer-when-downgrade",
    },
  });
}
