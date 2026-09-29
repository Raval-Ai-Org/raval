// "Upgrade now" while card checkout is not connected: the owner sends a
// purchase request, Mellox confirms payment and activates it from /admin.
import { z } from "zod";
import { defineRoute } from "@/server/route";

export const dynamic = "force-dynamic";

const Body = z.object({
  kind: z.enum(["plan", "credit_pack", "video_pack"]),
  key: z.string().min(1).max(50),
  interval: z.enum(["month", "year"]).optional(),
  contact: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

export const GET = defineRoute({
  name: "billing.requests.list",
  auth: "user",
  rateLimit: "billing-read",
  handler: async ({ userId }) => {
    const { listOwnPurchaseRequests } = await import("@/server/billing/manual.server");
    return { requests: await listOwnPurchaseRequests(userId) };
  },
});

export const POST = defineRoute({
  name: "billing.requests.create",
  auth: "user",
  body: Body,
  rateLimit: "billing-request",
  handler: async ({ userId, body }) => {
    const { createPurchaseRequest } = await import("@/server/billing/manual.server");
    const { request, created } = await createPurchaseRequest({
      userId,
      kind: body.kind,
      key: body.key,
      interval: body.interval,
      contact: body.contact,
      note: body.note,
    });
    return { ok: true as const, request, created };
  },
});

export const DELETE = defineRoute({
  name: "billing.requests.cancel",
  auth: "user",
  query: z.object({ id: z.string().uuid() }),
  rateLimit: "billing-request",
  handler: async ({ userId, query }) => {
    const { cancelOwnPurchaseRequest } = await import("@/server/billing/manual.server");
    await cancelOwnPurchaseRequest(userId, query.id);
    return { ok: true as const };
  },
});
