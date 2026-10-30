import "server-only";
import { createServerFn } from "@/server/server-fn";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { WorkspacePulse } from "@/lib/pulse/pulse";

// The workspace pulse (src/lib/pulse/pulse.ts): what waits for a person and
// what is running, for the chat screen. Membership only; free; reads with the
// caller's own client.

export const getWorkspacePulse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }): Promise<WorkspacePulse> => {
    const { requireWorkspaceRole } = await import("@/server/workspace-access.server");
    await requireWorkspaceRole(context, data.workspaceId, "viewer");
    const { readPulse } = await import("@/server/pulse/pulse.server");
    return readPulse(context.supabase as unknown as SupabaseClient, data.workspaceId);
  });
