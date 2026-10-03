// strategy.server.ts — the one-time setup Mellox proposes, so a person only
// has to say yes. It reads Brand DNA (by the verified workspace id) and the
// accounts already connected, and returns a brand strategy plus sensible
// settings. The model writes the words; the settings are decided here.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { llmJson } from "@/lib/ai-gateway.server";
import {
  AUTOPILOT_GOALS,
  StrategySchema,
  type AutopilotGoal,
  type ProgramSettings,
  type Strategy,
  type StrategySuggestion,
} from "@/lib/autopilot/contracts";
import { estimateCost } from "@/lib/autopilot/policy";
import { DEFAULT_STORY_SETTINGS, type StorySettings } from "@/lib/stories/schedule";
import { isStoryPlatform } from "@/lib/stories/placement";
import { isValidTimeZone } from "@/lib/autopilot/time";
import { isFullAutopilotEnabled } from "@/lib/feature-flags";
import type { PlatformId } from "@/lib/social-platforms";
import { runWithScope } from "@/server/request-context";
import { loadStudioContext } from "@/server/studio/context.server";
import { connectedPlatforms } from "./ports.server";

const db = supabaseAdmin as unknown as SupabaseClient;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "audience", "voice", "goal", "pillars"],
  properties: {
    summary: { type: "string" },
    audience: { type: "string" },
    voice: { type: "string" },
    goal: { type: "string" },
    pillars: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "detail"],
        properties: { title: { type: "string" }, detail: { type: "string" } },
      },
    },
  },
} as const;

const SYSTEM = `You write a short social media strategy for one brand, from its brand context.

Return:
- "summary": one or two plain sentences on what the brand's posts should do for it. No jargon.
- "audience": one sentence naming who the posts are for.
- "voice": a few words on how the brand should sound.
- "goal": exactly one of awareness, leads, sales, engagement, trust, launch — whichever fits the brand best.
- "pillars": 3 or 4 content themes. Each has a "title" (2 to 4 words) and a "detail" (one sentence saying what posts under it cover).

Rules:
- Use only what the brand context says. Never invent products, numbers, customers or claims.
- Write for a busy owner: short, concrete, everyday words.
- Pillars must be different from each other and specific to this brand, not generic marketing advice.`;

const BASIC: Strategy = {
  summary: "Show up regularly with useful posts so more of the right people know and trust you.",
  audience: "The people you already serve, and others like them.",
  voice: "Clear, friendly and helpful",
  pillars: [
    { title: "Helpful tips", detail: "One practical thing your audience can use today." },
    { title: "What you offer", detail: "A product or service and the problem it solves." },
    { title: "Behind the scenes", detail: "The people and the work behind your brand." },
    { title: "Questions", detail: "Something easy and interesting for followers to answer." },
  ],
};

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

export async function suggestStrategy(args: {
  workspaceId: string;
  userId: string;
  timezone: string;
}): Promise<StrategySuggestion> {
  const { workspaceId, userId } = args;
  const [ctx, connected] = await Promise.all([
    loadStudioContext(db, workspaceId, null),
    connectedPlatforms(workspaceId).catch(() => [] as string[]),
  ]);
  const hasBrand = ctx.brandText.trim().length > 120;

  let strategy = BASIC;
  let goal: AutopilotGoal = "awareness";
  let source: StrategySuggestion["source"] = "basic";

  if (hasBrand) {
    try {
      const out = await runWithScope({ workspaceId, userId, route: "autopilot.strategy" }, () =>
        llmJson<Record<string, unknown>>({
          route: "autopilot.strategy",
          system: SYSTEM,
          user: `BRAND CONTEXT:\n${ctx.brandText}`,
          maxTokens: 2_000,
          outputSchema: SCHEMA as unknown as Record<string, unknown>,
          timeoutMs: 45_000,
          retries: 1,
          fallback: {},
        }),
      );
      const pillars = (Array.isArray(out.pillars) ? out.pillars : [])
        .map((p) => {
          const row = (p ?? {}) as Record<string, unknown>;
          return { title: clean(row.title, 60), detail: clean(row.detail, 200) };
        })
        .filter((p) => p.title.length >= 2)
        .slice(0, 4);
      const parsed = StrategySchema.safeParse({
        summary: clean(out.summary, 400),
        audience: clean(out.audience, 240),
        voice: clean(out.voice, 160),
        pillars,
      });
      if (parsed.success && parsed.data.pillars.length >= 2 && parsed.data.summary.length > 20) {
        strategy = parsed.data;
        source = "model";
        if ((AUTOPILOT_GOALS as readonly string[]).includes(String(out.goal))) {
          goal = out.goal as AutopilotGoal;
        }
      }
    } catch (error) {
      console.error("[autopilot] strategy suggestion failed; using the basic one", error);
    }
  }

  const platforms = (connected.length ? connected.slice(0, 3) : ["linkedin"]) as PlatformId[];
  const postsPerWeek = 5;
  // A daily Story when an Instagram or Facebook account is connected: it's
  // where Stories live, and one a day is the habit that works.
  const storyPlatforms = connected.filter(isStoryPlatform);
  const stories = {
    ...DEFAULT_STORY_SETTINGS,
    enabled: storyPlatforms.length > 0,
    platforms: (storyPlatforms.length
      ? storyPlatforms
      : ["instagram"]) as StorySettings["platforms"],
  };
  const contentTypes = ["social", "image", "carousel", "video"] as const;
  const estimate =
    Math.max(...contentTypes.map((type) => estimateCost(type).credits)) * postsPerWeek +
    (stories.enabled ? estimateCost("story").credits * stories.perDay * 7 : 0);
  const settings: ProgramSettings = {
    // Set up once and it runs: fully automatic where that is allowed. Its
    // checks still hold anything unsure for a person.
    mode: isFullAutopilotEnabled(workspaceId) ? "full" : "autopilot",
    goal,
    goalNote: "",
    platforms,
    contentTypes: [...contentTypes],
    postsPerWeek,
    weekdays: [1, 2, 3, 4, 5],
    timezone: isValidTimeZone(args.timezone) ? args.timezone : "UTC",
    weeks: 52,
    creditCapPerWeek: Math.ceil((estimate * 1.5) / 10) * 10,
    videoCapPerWeek: 1,
    actOnOpportunities: true,
    styleId: null,
    strategy,
    automations: ["geo_scan"],
    stories,
  };
  return { strategy, settings, source, hasBrand };
}
