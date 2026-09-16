"use client";

// Resolves links from before workspaces had their own URLs (/app, /workspace,
// /app/content, /app/chat/<id>, ?invite_token=…) to the canonical
// /w/<workspaceId>/app route — without ever guessing a workspace:
//   - ?workspace=<id>        → that workspace (the provider still verifies access)
//   - /app/chat/<conversation> → the conversation's own workspace, if visible
//   - ?invite_token=<token>  → accept, then the invited workspace
//   - anything else          → /projects, where the user picks one
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { acceptWorkspaceInvite } from "@/lib/workspaces.functions";
import {
  conversationPath,
  isWorkspaceId,
  resolveLegacyAppLink,
  workspacePath,
  WORKSPACES_HOME,
} from "@/lib/workspace/paths";
import { WorkspaceLoading } from "@/components/workspace/WorkspaceProvider";

export function LegacyAppRedirect() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const url = new URL(window.location.href);
      const go = (href: string) => {
        if (!cancelled) router.replace(href);
      };

      const token = url.searchParams.get("invite_token");
      if (token) {
        url.searchParams.delete("invite_token");
        try {
          const wsId = await acceptWorkspaceInvite({ data: { token } });
          if (typeof wsId === "string" && isWorkspaceId(wsId)) {
            return go(workspacePath(wsId, "", url.searchParams.toString()));
          }
        } catch (e) {
          toast.error("That invite couldn't be accepted", {
            description: e instanceof Error ? e.message : undefined,
          });
        }
        return go(WORKSPACES_HOME);
      }

      const target = resolveLegacyAppLink(url.pathname, url.search);
      if (target.kind !== "conversation") return go(target.href);

      const { data } = await supabase
        .from("conversations")
        .select("workspace_id")
        .eq("id", target.conversationId)
        .maybeSingle();
      if (data?.workspace_id) {
        return go(`${conversationPath(data.workspace_id, target.conversationId)}${target.search}`);
      }
      go(WORKSPACES_HOME);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return <WorkspaceLoading />;
}
