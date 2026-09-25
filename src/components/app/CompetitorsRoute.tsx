"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { emitAppEvent } from "@/lib/app-events";
import { workspacePath } from "@/lib/workspace/paths";

/** Old competitor links now open the section inside Brand DNA. */
export default function CompetitorsRoute() {
  const router = useRouter();
  const workspaceId = useOptionalWorkspaceId();

  useEffect(() => {
    if (!workspaceId) return;
    router.replace(workspacePath(workspaceId));
    window.requestAnimationFrame(() => emitAppEvent("open:brand-dna", { tab: "competitors" }));
  }, [router, workspaceId]);

  return null;
}
