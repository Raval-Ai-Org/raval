import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SECTOR_PLAYBOOKS } from "./data.generated";
import { sectorLinesFor, sectorPlaybook } from "./select.server";
import { SECTOR_KINDS } from "@/lib/studio/sectors/kinds.generated";
import { businessKindOf, sectorOf } from "@/lib/studio/sectors/kinds";
import { typeVoiceById } from "@/lib/studio/type-voices";
import { INDUSTRIES } from "@/lib/studio/knowledge/industries";
import { BRANDS } from "../../../../evals/creative/cases";
import { skillLinesBody } from "@/lib/studio/skill-lines";
import { sellsService } from "@/lib/studio/post-plan";
import { emptyContext } from "@/lib/studio/prompts";

const ctx = (industry: string, brandText = "") => ({ industry, brandText });

describe("sector playbooks (round 9)", () => {
  it("has the researched sectors, unique ids, browser half in step", () => {
    expect(SECTOR_PLAYBOOKS.length).toBeGreaterThanOrEqual(80);
    const ids = SECTOR_PLAYBOOKS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(SECTOR_KINDS.map((s) => s.id)).toEqual(ids);
  });

  it("every playbook is complete and within limits", () => {
    const industries = new Set(INDUSTRIES.map((i) => i.id));
    for (const s of SECTOR_PLAYBOOKS) {
      expect(industries.has(s.parent as never), `${s.id} parent`).toBe(true);
      expect(s.match.length, s.id).toBeGreaterThanOrEqual(3);
      expect(s.show.length, s.id).toBeGreaterThan(20);
      expect(s.show.length, s.id).toBeLessThanOrEqual(200);
      expect(s.cliches.length, s.id).toBeLessThanOrEqual(3);
      expect(s.proof.length, s.id).toBeGreaterThan(0);
      for (const v of s.typeVoices) expect(typeVoiceById(v), `${s.id} voice ${v}`).not.toBeNull();
    }
  });

  it("never suggests fake proof", () => {
    const FAKE =
      /\b(guaranteed results|#1 in|number one|best in (the )?(city|country|world)|100% (success|satisfaction)|award-winning)\b/i;
    for (const s of SECTOR_PLAYBOOKS) {
      expect(`${s.show} ${s.proof.join(" ")} ${s.angles.join(" ")}`, s.id).not.toMatch(FAKE);
    }
  });

  it("finds the businesses that were worst: web agencies, game studios, plumbers", () => {
    expect(sectorOf("Web development agency")?.id).toBe("web-dev-agency");
    expect(sectorOf("Plumbing", "Emergency plumbing and boiler repair")?.id).toBe("plumbing");
    expect(sectorOf("Game studio", "We make indie games for PC and console")?.kind).toBeDefined();
    expect(businessKindOf("Bakery", "Fresh bread and cakes")).not.toBe("service");
    // One passing word in the description is not a sector.
    expect(sectorOf(null, "We love coffee")).toBeNull();
  });

  it("gives at most two short lines, never more than the cap", () => {
    const lines = sectorLinesFor(ctx("Plumbing", "Emergency plumbing and leak repair"));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(skillLinesBody(lines).join(" ").length).toBeLessThanOrEqual(450);
    expect(sectorLinesFor(ctx("Plumbing", "leak repair"), { visual: false })[0]).toMatch(/want/);
    expect(sectorLinesFor(ctx(""))).toEqual([]);
  });

  it("maps every bench brand to its sector (regression)", () => {
    const expected: Record<string, string | undefined> = {
      ledgerly: "saas",
      promptpilot: undefined,
      noorthreads: "modest-fashion",
      velvetbare: "skincare",
      karachigrill: "restaurant",
      brewline: "cafe",
      keystone: "real-estate-agent",
      brightpath: "education-tutoring",
      ironroots: "gym-fitness-studio",
      carewell: "clinic-doctor",
      sahulat: "fintech-banking",
      lexbridge: "law-firm",
      motorhaus: "auto-repair-detailing",
      hunzatrails: "travel-agency",
      thelinen: "hotel-resort",
      growthforge: "marketing-agency",
      petalpost: "florist",
      chaiwala: "cafe",
      stacksecure: "consulting-b2b",
      greenbasket: "grocery-store",
    };
    for (const brand of BRANDS)
      expect(sectorOf(brand.industry, brand.dna)?.id, brand.id).toBe(expected[brand.id]);
  });

  it("bench brands: flags off decide services exactly as before", () => {
    for (const brand of BRANDS) {
      const base = {
        ctx: { ...emptyContext(brand.name), industry: brand.industry, brandText: brand.dna },
      };
      expect(sellsService({ ...base, skills: {} } as never)).toBe(sellsService(base as never));
      // With the pack on, a sector may refine it, and the playbook lookup never throws.
      sectorPlaybook({ industry: brand.industry, brandText: brand.dna });
    }
  });
});
