import { cookies } from "next/headers";
import { completeNotionOAuth } from "@/server/connectors/notion/service.server";
import {
  matchesNotionBrowserState,
  NOTION_STATE_COOKIE,
} from "@/server/connectors/notion/oauth.server";
import { workspacePath } from "@/lib/workspace/paths";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const state = query.get("state") ?? "";
  const code = query.get("code") ?? "";
  const jar = await cookies();
  const browserState = jar.get(NOTION_STATE_COOKIE)?.value;
  jar.set(NOTION_STATE_COOKIE, "", {
    path: "/api/integrations/notion/callback",
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax",
  });
  if (query.has("error") || !state || !code || state.length > 128 || code.length > 2048)
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/integrations/notion/result?status=cancelled",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  if (!matchesNotionBrowserState(state, browserState))
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/integrations/notion/result?status=failed",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  try {
    const result = await completeNotionOAuth({ state, code });
    const target = workspacePath(result.workspaceId, "", {
      settings: "accounts",
      notion: "connected",
    });
    return new Response(null, {
      status: 302,
      headers: { Location: target, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  } catch {
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/integrations/notion/result?status=failed",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  }
}
