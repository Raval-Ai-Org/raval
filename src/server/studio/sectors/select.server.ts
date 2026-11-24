// select.server.ts — the sector lines a piece gets (Round 9 sectors pack,
// ADR-0053). Facts and taste about this kind of business, never menus: at
// most two short lines, picked by code. The playbooks are research with
// sources (docs/studio/research-2026-11/), compiled by
// scripts/sectors/build-sectors.mjs.
import "server-only";
import type { StudioContext } from "@/lib/studio/prompts";
import { sectorOf } from "@/lib/studio/sectors/kinds";
import { SECTOR_PLAYBOOKS } from "./data.generated";
import type { SectorPlaybook } from "./types";

const BY_ID = new Map(SECTOR_PLAYBOOKS.map((s) => [s.id, s]));

export function sectorPlaybook(
  ctx: Pick<StudioContext, "industry" | "brandText">,
): SectorPlaybook | null {
  const row = sectorOf(ctx.industry, ctx.brandText);
  return row ? (BY_ID.get(row.id) ?? null) : null;
}

export function sectorById(id: string | null | undefined): SectorPlaybook | null {
  return id ? (BY_ID.get(id) ?? null) : null;
}

/**
 * Pictures: what to show and what rings false (or the advertising rule that
 * binds it). Words-only pieces: what buyers want and doubt.
 */
export function sectorLinesFor(
  ctx: Pick<StudioContext, "industry" | "brandText">,
  opts: { visual?: boolean } = {},
): string[] {
  const s = sectorPlaybook(ctx);
  if (!s) return [];
  const label = s.label.toLowerCase().slice(0, 50);
  if (opts.visual === false)
    return [`Buyers of a ${label} want: ${s.wants}`, `They doubt: ${s.doubts}`];
  return [
    `For a ${label}, show the real thing: ${s.show}`,
    s.regulated
      ? `Advertising rule here: ${s.regulated}`
      : s.cliches.length
        ? `Rings false for this business: ${s.cliches.join(", ")}.`
        : "",
  ].filter(Boolean);
}
