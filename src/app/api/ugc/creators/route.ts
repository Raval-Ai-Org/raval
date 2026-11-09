// POST /api/ugc/creators — "Create your own creator": one photo of an
// original, fictional person from a short description, saved as one of the
// brand's people (an Inspo "Person" source) so it can star in every video.
// Charged as one standard image; a description of a real or famous person is
// refused before anything is spent.
import { z } from "zod";
import { generateImage } from "@/lib/openrouter-image.server";
import { CREATOR_AGES, SETTINGS } from "@/lib/ugc/options";
import { creatorPhotoPrompt, customCreatorProblem } from "@/lib/ugc/creators";
import { runMetered } from "@/server/billing/metered.server";
import { storeReferenceBytes } from "@/server/assets/reference-image.server";
import { addVisualSource } from "@/server/brand-visuals/service.server";
import { HttpError } from "@/server/http-error";
import { defineRoute } from "@/server/route";
import { assertUgcEnabled } from "@/server/ugc/route-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const ids = <T extends { id: string }>(list: readonly T[]) =>
  list.map((o) => o.id) as [T["id"], ...T["id"][]];

const Body = z.object({
  workspaceId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(100),
  name: z.string().trim().min(1).max(40),
  look: z.string().trim().min(1).max(400),
  gender: z.enum(["woman", "man", "person"]).default("person"),
  age: z.enum(ids(CREATOR_AGES)).default("any"),
  setting: z.enum(ids(SETTINGS)).default("auto"),
});

export const POST = defineRoute({
  name: "ugc/creators:create",
  auth: "workspace",
  minRole: "editor",
  body: Body,
  workspaceId: ({ body }) => body.workspaceId,
  rateLimit: "ugc-draft",
  handler: async ({ body, workspaceId, userId, role }) => {
    assertUgcEnabled(workspaceId);
    const problem = customCreatorProblem(body.name, body.look);
    if (problem) throw new HttpError(422, problem);

    const metered = await runMetered(
      {
        workspaceId,
        userId,
        role,
        action: "image_standard",
        idempotencyKey: `ugc-creator:${body.idempotencyKey}`,
        route: "ugc/creators:create",
      },
      async () => {
        const image = await generateImage({
          prompt: creatorPhotoPrompt({
            gender: body.gender,
            age: body.age,
            look: body.look,
            place: SETTINGS.find((s) => s.id === body.setting)?.prompt ?? "",
          }),
          size: "1024x1280",
          routing: { requiredQuality: "high" },
        });
        const stored = await storeReferenceBytes(
          workspaceId,
          new Uint8Array(Buffer.from(image.b64, "base64")),
          `creator-${body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`,
          null,
          {
            source: "ugc-custom-creator",
            idempotencyKey: `ugc-custom-creator:${body.idempotencyKey}`,
            metadata: { creator_name: body.name },
          },
        );
        await addVisualSource(
          { workspaceId, userId, role },
          {
            assetId: stored.assetId,
            label: body.name,
            purpose: "person",
            notes: `Mellox creator: ${body.look}`.slice(0, 500),
            formats: ["all"],
            kind: "library",
          },
        );
        return { person: { assetId: stored.assetId, url: stored.url, name: body.name } };
      },
    );
    return Response.json(
      metered.result,
      metered.balance === null
        ? undefined
        : { headers: { "X-Billing-Balance": String(metered.balance) } },
    );
  },
});
