// skill-lines.server.ts — the server picks the few Round 9 skill-pack lines
// a piece gets (ADR-0053). Prompt builders stay pure and light: they only
// place these strings in the Business section (src/lib/studio/skill-lines.ts
// caps them at 3 lines, 450 characters).
import "server-only";
import { sectorOf } from "@/lib/studio/sectors/kinds";
import { mechanismLineFor } from "./example-briefs.server";
import type { CreativeSkills } from "@/lib/feature-flags";
import type { StudioContext } from "@/lib/studio/prompts";
import { pickTypeVoice, typeVoiceLine, type TypeChoice } from "@/lib/studio/type-voices";
import { sectorLinesFor, sectorPlaybook } from "./sectors/select.server";

export type SkillPick = {
  lines: string[];
  /** The brand's type (type pack on), for code-drawn slides and `meta.type_voice`. */
  type: TypeChoice | null;
};

/** The business as text for matching: industry line first, then the brand text. */
export function businessText(ctx: StudioContext): string {
  return [ctx.industry ?? "", ctx.brandText?.slice(0, 1500) ?? ""].join("\n");
}

/**
 * The brand's type when the type pack is on. A brand whose style bible
 * learned its own type gets none from here: its look already carries it.
 */
export function brandTypeChoice(args: {
  workspaceId: string;
  ctx: StudioContext;
  skills: CreativeSkills;
  stored?: string | null;
}): TypeChoice | null {
  if (!args.skills.type) return null;
  const bible = args.ctx.visualTaste?.direction?.bible as { type?: unknown } | undefined;
  if (bible?.type && !args.stored) return null;
  const own = args.ctx.style?.visual?.typography;
  return pickTypeVoice({
    workspaceId: args.workspaceId,
    business: businessText(args.ctx),
    ownHeadline: own?.heading,
    ownText: own?.body,
    stored: args.stored,
    preferred: args.skills.sectors ? sectorPlaybook(args.ctx)?.typeVoices : undefined,
  });
}

export function skillLinesFor(args: {
  workspaceId: string;
  ctx: StudioContext;
  skills: CreativeSkills;
  /** A stored voice (campaign or the person's choice). */
  typeVoice?: string | null;
  /** The piece is a picture (type matters) or text only. */
  visual?: boolean;
  /** Studio format and the job's seed: one "why it sells" line from the brief library. */
  format?: string;
  seed?: string;
}): SkillPick {
  const lines: string[] = [];
  if (args.skills.sectors) lines.push(...sectorLinesFor(args.ctx, { visual: args.visual }));
  if (args.skills.sectors && args.format && args.seed) {
    const why = mechanismLineFor({
      sector: sectorOf(args.ctx.industry, args.ctx.brandText)?.id,
      format: args.format,
      seed: args.seed,
    });
    // Second, after what to show: the line cap must never drop it.
    if (why) lines.splice(Math.min(1, lines.length), 0, why.line);
  }
  const type =
    args.visual === false
      ? null
      : brandTypeChoice({
          workspaceId: args.workspaceId,
          ctx: args.ctx,
          skills: args.skills,
          stored: args.typeVoice,
        });
  if (type) lines.unshift(typeVoiceLine(type));
  return { lines, type };
}
