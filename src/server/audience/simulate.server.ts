// simulate.server.ts — the only place that asks a model how an audience
// reacts. Everything goes through the OpenRouter gateway (metered, budgeted,
// model chosen by route). An outside simulation engine would replace this
// file and nothing else: the engine only knows the AudiencePorts interface.
//
// Group descriptions and the piece itself are user-editable text, so both are
// wrapped as untrusted data before they reach a prompt.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { llmJson } from "@/lib/ai-gateway.server";
import type { TwinRow } from "@/lib/audience/contracts";
import {
  JUDGE_SCHEMA,
  judgeSystem,
  numberedVersions,
  REACT_SCHEMA,
  reactSystem,
  SCORE_SCHEMA,
  SCORE_SYSTEM,
  subjectText,
  SYNTH_SCHEMA,
  SYNTH_SYSTEM,
  VARIANTS_SCHEMA,
  variantsSystem,
} from "@/lib/audience/prompts";
import { twinBrief } from "@/lib/audience/twins";
import { isAudienceEnabled } from "@/lib/feature-flags";
import { settleAsyncChargeSoon } from "@/server/billing/async-charges.server";
import { wrapUntrusted } from "@/server/guardrails/untrusted";
import { runWithScope } from "@/server/request-context";
import { loadStudioContext } from "@/server/studio/context.server";
import { invalidateAudienceContext } from "./context.server";
import type { Actor, AudiencePorts } from "./engine";
import { buildTwinDrafts } from "./twins.server";

const db = supabaseAdmin as unknown as SupabaseClient;

type Schema = Record<string, unknown>;

/**
 * One metered call. The billing ids of whatever request this runs inside are
 * cleared: a charged run is settled from its own row, and the included score
 * must never be recorded against another action's charge.
 */
function ask(
  actor: Actor,
  route: string,
  args: { system: string; user: string; schema: Schema; maxTokens: number; timeoutMs?: number },
): Promise<unknown> {
  return runWithScope(
    {
      workspaceId: actor.workspaceId,
      userId: actor.userId ?? undefined,
      route,
      billingAccountId: undefined,
      billingChargeId: undefined,
    },
    () =>
      llmJson<unknown>({
        route,
        system: args.system,
        user: args.user,
        maxTokens: args.maxTokens,
        outputSchema: args.schema,
        timeoutMs: args.timeoutMs ?? 45_000,
        retries: 1,
        fallback: null,
      }),
  );
}

const group = (twin: TwinRow, route: string) =>
  wrapUntrusted(`audience group "${twin.name}"`, twinBrief(twin), { maxChars: 1200, route });

const piece = (text: string, route: string) =>
  wrapUntrusted("the content being judged", text, { maxChars: 6500, route });

export const realPorts: AudiencePorts = {
  now: () => new Date(),
  enabled: (workspaceId) => isAudienceEnabled(workspaceId),

  buildTwins: (actor, existing) => buildTwinDrafts(actor, existing),

  score(actor, twins, pieces) {
    const route = "audience.score";
    const audience = twins.map((twin) => group(twin, route)).join("\n\n");
    const list = pieces
      .map((p) => `### Piece ${p.index}\n${piece(subjectText(p.subject), route)}`)
      .join("\n\n");
    return ask(actor, route, {
      system: SCORE_SYSTEM,
      user: `AUDIENCE:\n${audience}\n\nPIECES:\n${list}`,
      schema: SCORE_SCHEMA as unknown as Schema,
      maxTokens: 400 + 400 * pieces.length,
      timeoutMs: 30_000,
    });
  },

  react(actor, twin, subject, people) {
    const route = "audience.react";
    return ask(actor, route, {
      system: reactSystem(people),
      user: `GROUP:\n${group(twin, route)}\n\nPIECE:\n${piece(subjectText(subject), route)}`,
      schema: REACT_SCHEMA as unknown as Schema,
      maxTokens: 2_400,
    });
  },

  async synthesize(actor, args) {
    const route = "audience.synthesize";
    const reactions = args.answers
      .map((a) =>
        [
          `${a.twinName}:`,
          a.likes.length ? `  liked: ${a.likes.join("; ")}` : "",
          a.objections.length ? `  doubted: ${a.objections.join("; ")}` : "",
          ...a.people.slice(0, 4).map((p) => `  ${p.stance}: "${p.quote}"`),
        ]
          .filter(Boolean)
          .join("\n"),
      )
      .join("\n");
    const out = (await ask(actor, route, {
      system: SYNTH_SYSTEM,
      user: [
        `PIECE:\n${piece(subjectText(args.subject), route)}`,
        `SCORES (0-100): overall ${args.overall}; ${Object.entries(args.dimensions)
          .map(([k, v]) => `${k} ${v}`)
          .join(", ")}`,
        `REACTIONS:\n${wrapUntrusted("simulated reactions", reactions, { maxChars: 5000, route })}`,
      ].join("\n\n"),
      schema: SYNTH_SCHEMA as unknown as Schema,
      maxTokens: 1_200,
    })) as { why?: unknown; fixes?: unknown } | null;
    if (!out || typeof out.why !== "string") throw new Error("No summary was returned.");
    return {
      why: out.why,
      fixes: Array.isArray(out.fixes)
        ? out.fixes.filter((f): f is string => typeof f === "string")
        : [],
    };
  },

  async writeVariants(actor, twins, subject, count) {
    const route = "audience.variants";
    const brand = await loadStudioContext(db, actor.workspaceId, null)
      .then((ctx) => ctx.brandText.slice(0, 2500))
      .catch(() => "");
    const out = (await ask(actor, route, {
      system: variantsSystem(count),
      user: [
        brand ? `BRAND:\n${wrapUntrusted("brand context", brand, { maxChars: 2600, route })}` : "",
        `AUDIENCE:\n${twins.map((twin) => group(twin, route)).join("\n\n")}`,
        `ORIGINAL:\n${piece(subjectText(subject), route)}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      schema: VARIANTS_SCHEMA as unknown as Schema,
      maxTokens: 3_000,
      timeoutMs: 60_000,
    })) as { versions?: unknown } | null;
    const versions = Array.isArray(out?.versions) ? out.versions : [];
    return versions.map((v) => {
      const row = (v ?? {}) as Record<string, unknown>;
      return {
        label: typeof row.label === "string" ? row.label : "",
        title: subject.title,
        body: typeof row.body === "string" ? row.body : "",
      };
    });
  },

  judge(actor, twin, versions, people, subject) {
    // The same kind of answer as a reaction: one group, simulated people.
    const route = "audience.react";
    const where = subject.platform ? ` for ${subject.platform}` : "";
    return ask(actor, route, {
      system: judgeSystem(people, versions.length),
      user: [
        `GROUP:\n${group(twin, route)}`,
        `Type: ${subject.kind}${where}`,
        `VERSIONS:\n${piece(numberedVersions(versions), route)}`,
      ].join("\n\n"),
      schema: JUDGE_SCHEMA as unknown as Schema,
      maxTokens: 600 + 350 * versions.length,
      // Every version is read and compared, so this is the slowest answer.
      timeoutMs: 90_000,
    });
  },

  finished(run) {
    settleAsyncChargeSoon("audience_run", run.id);
  },

  changed(workspaceId) {
    invalidateAudienceContext(workspaceId);
  },
};
