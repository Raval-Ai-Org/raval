// POST /api/ugc/projects/:id/storyboard — the storyboard of a Creator video
// before it is made (src/lib/studio/video/board.ts): the saved script's scenes
// plus one drawn frame per scene. Drawn once per script; showing the same
// script's board again is free. Nothing is rendered or held for the video.
import { z } from "zod";
import { defineRoute } from "@/server/route";
import { runMetered } from "@/server/billing/metered.server";
import { assertUgcEnabled, idAfter } from "@/server/ugc/route-helpers";
import { creatorStoryboard } from "@/server/ugc/service.server";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const Body = z.object({
  workspaceId: z.string().uuid(),
  aspectRatio: z.enum(["9:16", "16:9", "1:1", "4:5"]).default("9:16"),
});

export const POST = defineRoute({
  name: "ugc/projects:storyboard",
  auth: "workspace",
  minRole: "editor",
  body: Body,
  workspaceId: ({ body }) => body.workspaceId,
  rateLimit: "ugc-draft",
  handler: async ({ request, body, workspaceId, userId, role, supabase }) => {
    assertUgcEnabled(workspaceId);
    const id = idAfter(request, "projects");
    let balance: number | null = null;
    const view = await creatorStoryboard(
      supabase,
      { workspaceId, projectId: id, aspectRatio: body.aspectRatio },
      async (draw) => {
        const metered = await runMetered(
          {
            workspaceId,
            userId,
            role,
            action: "video_storyboard",
            idempotencyKey: request.headers.get("Idempotency-Key") ?? crypto.randomUUID(),
            route: "ugc/projects:storyboard",
          },
          draw,
        );
        balance = metered.balance;
        return metered.result;
      },
    );
    return Response.json(
      view,
      balance === null ? undefined : { headers: { "X-Billing-Balance": String(balance) } },
    );
  },
});
