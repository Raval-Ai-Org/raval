// Facebook Login for Business returns here. The state must match the httpOnly
// cookie of the browser that started it, and is used once. The person lands
// on the workspace's Inbox with ?meta=<result>; in a sign-in window,
// ConnectWindowReturn announces that result and closes the window.
import { cookies } from "next/headers";
import { completeMetaOAuth } from "@/server/engage/service.server";
import { META_CALLBACK_PATH } from "@/server/engage/meta/config.server";
import {
  META_STATE_COOKIE,
  matchesMetaBrowserState,
  peekMetaStateWorkspace,
} from "@/server/engage/meta/oauth.server";
import { isWorkspaceId, workspacePath } from "@/lib/workspace/paths";

export const dynamic = "force-dynamic";

function go(location: string) {
  return new Response(null, {
    status: 302,
    headers: { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

async function landing(
  state: string,
  status: "connected" | "cancelled" | "error",
  workspaceId?: string,
) {
  const id = workspaceId ?? (await peekMetaStateWorkspace(state).catch(() => null));
  return id && isWorkspaceId(id)
    ? workspacePath(id, "inbox", { meta: status })
    : `/projects?meta=${status}`;
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const state = query.get("state") ?? "";
  const code = query.get("code") ?? "";
  const jar = await cookies();
  const browserState = jar.get(META_STATE_COOKIE)?.value;
  jar.set(META_STATE_COOKIE, "", {
    path: META_CALLBACK_PATH,
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax",
  });

  if (state.length > 128 || code.length > 2048) return go("/projects?meta=error");
  if (query.has("error") || !state || !code) return go(await landing(state, "cancelled"));
  if (!matchesMetaBrowserState(state, browserState)) return go(await landing(state, "error"));
  try {
    const result = await completeMetaOAuth({ state, code });
    return go(await landing(state, "connected", result.workspaceId));
  } catch (error) {
    console.error("[engage] Meta connect failed", error instanceof Error ? error.message : error);
    return go(await landing(state, "error"));
  }
}
