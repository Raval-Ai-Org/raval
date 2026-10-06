import { cookies } from "next/headers";
import { workspacePath } from "@/lib/workspace/paths";
import {
  completeSlackOAuth,
  matchesSlackState,
  SLACK_STATE_COOKIE,
} from "@/server/slack/oauth.server";

export const dynamic = "force-dynamic";
const appOrigin = "https://mellox.ai";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const jar = await cookies();
  const cookie = jar.get(SLACK_STATE_COOKIE)?.value;
  jar.set(SLACK_STATE_COOKIE, "", { path: "/api/integrations/slack/oauth/callback", maxAge: 0 });
  if (url.searchParams.has("error") || !matchesSlackState(state, cookie))
    return Response.redirect(new URL("/projects?slack=failed", appOrigin));
  try {
    const workspaceId = await completeSlackOAuth(state, code);
    return Response.redirect(
      new URL(
        workspacePath(workspaceId, "", { settings: "accounts", slack: "connected" }),
        appOrigin,
      ),
    );
  } catch {
    return Response.redirect(new URL("/projects?slack=failed", appOrigin));
  }
}
