import { z } from "zod";
import { defineRoute } from "@/server/route";
import { listAccountsHandler } from "@/lib/postforme/handlers";
import { withPostForMe } from "@/lib/postforme/route.server";
import {
  activateSocialProfileSlot,
  assertSocialProfileConnection,
  reserveSocialProfileSlot,
} from "@/server/billing/social-profiles.server";

export const dynamic = "force-dynamic";

export const POST = defineRoute({
  name: "social/connect/postforme/complete",
  auth: "workspace",
  body: z.object({
    workspaceId: z.string(),
    platform: z.string(),
    accountIds: z.array(z.string().min(1)).min(1),
  }),
  workspaceId: ({ body }) => body.workspaceId,
  minRole: "editor",
  handler: async ({ body, workspaceId, userId, role }) => {
    const entitlements = await assertSocialProfileConnection({ workspaceId, userId, role });
    await reserveSocialProfileSlot(entitlements, workspaceId);
    const response = await withPostForMe(workspaceId, (deps) =>
      listAccountsHandler(workspaceId, deps),
    );
    if (!response.ok) return response;
    const accounts = (await response.json()) as Array<{
      accountId: string;
      platform: string;
      status: string;
    }>;
    if (
      !accounts.some(
        (account) =>
          body.accountIds.includes(account.accountId) &&
          account.platform === body.platform &&
          account.status === "active",
      )
    ) {
      return Response.json(
        { error: { code: "NOT_FOUND", detail: "The connected account has not appeared yet" } },
        { status: 404 },
      );
    }
    await activateSocialProfileSlot(entitlements, workspaceId);
    return Response.json({ connected: true });
  },
});
