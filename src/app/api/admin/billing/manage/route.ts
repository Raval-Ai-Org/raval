// Billing admin console: activate a plan or pack that was paid offline, end a
// manual plan, or decline a request. Every write is keyed by an operation id
// generated when the admin opens the form, so a double click is a replay.
// Activations are audited in billing_manual_activations (append-only).
import { z } from "zod";
import { defineRoute } from "@/server/route";
import { requireBillingAdmin } from "@/server/billing/admin.server";

export const dynamic = "force-dynamic";

const reason = z.string().trim().min(3).max(500);
const Body = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("activate_plan"),
    operationId: z.string().uuid(),
    accountId: z.string().uuid(),
    plan: z.enum(["starter", "growth", "agency", "scale"]),
    interval: z.enum(["month", "year"]),
    months: z.number().int().min(1).max(36),
    reason,
    reference: z.string().trim().max(200).optional(),
    requestId: z.string().uuid().optional(),
  }),
  z.object({
    op: z.literal("grant_pack"),
    operationId: z.string().uuid(),
    accountId: z.string().uuid(),
    kind: z.enum(["credit_pack", "video_pack"]),
    key: z.string().min(1).max(50),
    reason,
    reference: z.string().trim().max(200).optional(),
    requestId: z.string().uuid().optional(),
  }),
  z.object({
    op: z.literal("end_plan"),
    operationId: z.string().uuid(),
    accountId: z.string().uuid(),
    reason,
  }),
  z.object({
    op: z.literal("decline_request"),
    requestId: z.string().uuid(),
    note: z.string().trim().max(500).optional(),
  }),
]);

export const POST = defineRoute({
  name: "billing.admin.manage",
  auth: "user",
  body: Body,
  rateLimit: "billing-admin",
  handler: async ({ userId, body }) => {
    requireBillingAdmin(userId);
    const manual = await import("@/server/billing/manual.server");
    let result: Record<string, unknown>;
    switch (body.op) {
      case "activate_plan":
        result = await manual.activateManualPlan({ ...body, actor: userId });
        break;
      case "grant_pack":
        result = await manual.grantManualPack({ ...body, actor: userId });
        break;
      case "end_plan":
        result = await manual.endManualPlan({ ...body, actor: userId });
        break;
      case "decline_request":
        await manual.declinePurchaseRequest({ ...body, actor: userId });
        result = {};
        break;
    }
    return { ok: true as const, ...result };
  },
});
