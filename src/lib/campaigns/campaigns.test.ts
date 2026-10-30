// Campaigns: the playbooks hold together, the skeleton lays out real dates
// without crowding a day, media lands where it suits, the model can't slip a
// fact or a foreign link in, and a plan change never touches a made piece.
import { describe, expect, it } from "vitest";
import { DELIVERABLES } from "@/lib/studio/creative-knowledge";
import { HOOK_STYLES } from "@/lib/studio/memory";
import { SHARE_AIMS } from "@/lib/studio/viral";
import { STORY_THEME_IDS } from "@/lib/stories/frames";
import { STUDIO_FORMATS } from "@/lib/studio/formats";
import { CampaignBriefSchema, type CampaignMedia, type CampaignPiece } from "./contracts";
import { groundCampaignPlan, groundText } from "./ground";
import { ctaFor, goalLine, isShareableLink, linkRule } from "./links";
import { assignMedia, settleFormats } from "./media";
import { campaignProgress, currentPhase, pieceState } from "./progress";
import { PLAYBOOKS, playbookById } from "./playbooks";
import { pieceBrief, planUserPrompt } from "./prompt";
import { buildCampaignSkeleton, campaignWindow } from "./skeleton";
import { suggestCampaigns } from "./suggest";
import { diffPieces, pieceSignature } from "./sync";

const TODAY = "2026-11-01";
const brief = (over: Record<string, unknown> = {}) =>
  CampaignBriefSchema.parse({
    type: "product-launch",
    name: "Aurora lamp",
    startsOn: "2026-11-02",
    keyDate: "2026-11-20",
    channels: ["instagram", "linkedin", "facebook"],
    goal: { kind: "sales", link: "https://shop.example.com/aurora" },
    ...over,
  });

describe("playbooks", () => {
  const deliverables = new Set(DELIVERABLES.map((d) => d.id));
  const hooks = new Set(HOOK_STYLES.map((h) => h.id));
  const aims = new Set(SHARE_AIMS.map((a) => a.id));
  const themes = new Set<string>(STORY_THEME_IDS);

  it("has unique ids and every phase points at real rules", () => {
    expect(new Set(PLAYBOOKS.map((p) => p.id)).size).toBe(PLAYBOOKS.length);
    for (const playbook of PLAYBOOKS) {
      expect(new Set(playbook.phases.map((p) => p.id)).size).toBe(playbook.phases.length);
      expect(playbook.phases.some((p) => p.when === "day")).toBe(true);
      for (const phase of playbook.phases) {
        expect(deliverables.has(phase.deliverable), `${playbook.id}/${phase.id}`).toBe(true);
        for (const h of phase.hooks)
          expect(hooks.has(h), `${playbook.id}/${phase.id}/${h}`).toBe(true);
        for (const a of phase.aims) expect(aims.has(a)).toBe(true);
        for (const f of phase.formats) expect(STUDIO_FORMATS[f]).toBeTruthy();
        if (phase.story) expect(themes.has(phase.story)).toBe(true);
        expect(phase.id).toMatch(/^[a-z0-9-]+$/);
      }
    }
  });
});

describe("skeleton", () => {
  const launch = playbookById("product-launch")!;

  it("lays phases around the key date", () => {
    const s = buildCampaignSkeleton(launch, brief(), [], TODAY);
    expect(s.keyDate).toBe("2026-11-20");
    expect(s.endsOn).toBe("2026-11-30");
    const day = s.phases.find((p) => p.id === "launch")!;
    expect(day.startsOn).toBe("2026-11-20");
    for (const p of s.phases.filter((p) => p.id === "tease" || p.id === "reveal"))
      expect(p.endsOn < "2026-11-20").toBe(true);
    for (const piece of s.pieces) {
      const phase = s.phases.find((p) => p.id === piece.phase)!;
      expect(piece.date >= phase.startsOn && piece.date <= phase.endsOn).toBe(true);
    }
  });

  it("never puts two feed posts on one channel and day, nor on a taken one", () => {
    const taken = [{ date: "2026-11-20", platform: "instagram" }];
    const s = buildCampaignSkeleton(launch, brief({ pace: "push" }), taken, TODAY);
    const keys = s.pieces.filter((p) => p.format !== "story").map((p) => `${p.date}|${p.platform}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain("2026-11-20|instagram");
  });

  it("gives each channel only formats it can carry and adds Stories on story channels", () => {
    const s = buildCampaignSkeleton(launch, brief(), [], TODAY);
    for (const p of s.pieces) {
      if (p.format === "story") expect(["instagram", "facebook"]).toContain(p.platform);
      else expect(STUDIO_FORMATS[p.format].platforms).toContain(p.platform);
    }
    expect(s.pieces.some((p) => p.format === "story")).toBe(true);
    const noStories = buildCampaignSkeleton(launch, brief({ stories: false }), [], TODAY);
    expect(noStories.pieces.some((p) => p.format === "story")).toBe(false);
  });

  it("never opens two feed pieces in a row the same way", () => {
    const feed = buildCampaignSkeleton(launch, brief(), [], TODAY).pieces.filter(
      (p) => p.format !== "story",
    );
    // Placement order isn't date order once days shift, so check same-phase neighbours.
    const byPhase = new Map<string, CampaignPiece[]>();
    for (const p of feed) byPhase.set(p.phase, [...(byPhase.get(p.phase) ?? []), p]);
    for (const list of byPhase.values()) {
      const phase = launch.phases.find((ph) => ph.id === list[0].phase)!;
      if (phase.hooks.length < 2) continue;
      const ordered = [...list].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
      for (let i = 1; i < ordered.length; i++)
        expect(ordered[i].hook).not.toBe(ordered[i - 1].hook);
    }
  });

  it("starts tomorrow at the earliest and runs its weeks without a key date", () => {
    const w = campaignWindow(
      playbookById("teach")!,
      { startsOn: "2026-10-01", keyDate: null, weeks: 2 },
      TODAY,
    );
    expect(w.startsOn).toBe("2026-11-02");
    expect(w.endsOn).toBe("2026-11-15");
  });
});

describe("media", () => {
  const launch = playbookById("product-launch")!;
  const photo = (id: string, role: CampaignMedia["role"]): CampaignMedia => ({
    assetId: `00000000-0000-4000-8000-00000000000${id}`,
    kind: "image",
    role,
    label: "",
  });

  it("swaps video for another format when there is nothing to edit", () => {
    const s = buildCampaignSkeleton(launch, brief({ channels: ["instagram"] }), [], TODAY);
    const settled = settleFormats(launch, s.pieces, []);
    expect(settled.some((p) => p.format === "video")).toBe(false);
  });

  it("puts close-ups on the tease and the hero shot on the reveal", () => {
    const media = [photo("1", "detail"), photo("2", "hero")];
    const s = buildCampaignSkeleton(launch, brief({ channels: ["instagram"] }), [], TODAY);
    const placed = assignMedia(launch, settleFormats(launch, s.pieces, media), media);
    const tease = placed.find((p) => p.phase === "tease" && p.format === "image");
    const reveal = placed.find((p) => p.phase === "reveal" && p.mediaIds.length);
    if (tease) expect(tease.mediaIds).toEqual([media[0].assetId]);
    expect(reveal?.mediaIds).toContain(media[1].assetId);
    expect(placed.every((p) => p.format !== "story" || p.mediaIds.length === 0)).toBe(true);
  });
});

describe("grounding", () => {
  const opts = {
    known: (s: string) => !/\d/.test(s) || s.includes("20 November"),
    link: "https://shop.example.com/aurora",
    competitors: ["Lumio"],
  };

  it("drops invented figures, foreign links and competitor names", () => {
    expect(groundText("Save 40% today. It glows softly.", 300, opts)).toBe("It glows softly.");
    expect(
      groundText(
        "See https://evil.example.org now. Order here: https://shop.example.com/aurora",
        300,
        opts,
      ),
    ).not.toContain("evil");
    expect(groundText("Better than Lumio. Warm light for long nights.", 300, opts)).toBe(
      "Warm light for long nights.",
    );
    expect(groundText("Out on 20 November.", 300, opts)).toBe("Out on 20 November.");
  });

  it("only fills slots the skeleton has, and keeps a person's edit", () => {
    const launch = playbookById("product-launch")!;
    const s = buildCampaignSkeleton(launch, brief(), [], TODAY);
    const edited = {
      ...s.pieces[0],
      edited: true,
      title: "Mine",
      idea: "My own idea for this one.",
    };
    const pieces = [edited, ...s.pieces.slice(1)];
    const raw = {
      bigIdea: "Light that waits for you.",
      pieces: [
        { id: pieces[0].id, title: "Model", idea: "Model idea that is long enough." },
        {
          id: pieces[1].id,
          title: "A glow in the dark",
          idea: "A close-up of the lamp's edge at dusk, nothing more.",
        },
        { id: "made-up", title: "x", idea: "y" },
      ],
    };
    const labels = Object.fromEntries(s.phases.map((p) => [p.id, p.label]));
    const out = groundCampaignPlan(raw, pieces, labels, opts);
    expect(out.pieces).toHaveLength(pieces.length);
    expect(out.pieces[0].title).toBe("Mine");
    expect(out.pieces[1].title).toBe("A glow in the dark");
    expect(out.pieces.every((p) => p.title.length > 0)).toBe(true);
    expect(out.bigIdea).toBe("Light that waits for you.");
  });
});

describe("links", () => {
  const goal = {
    kind: "registrations" as const,
    link: "https://forms.example.com/r",
    linkLabel: "",
  };
  it("puts the link in captions where it works and says 'link in bio' where it doesn't", () => {
    expect(linkRule("linkedin", goal, "link").mode).toBe("caption");
    expect(linkRule("instagram", goal, "link").mode).toBe("bio");
    expect(linkRule("instagram", goal, "none").mode).toBe("none");
    expect(ctaFor("linkedin", goal, "link")).toContain("https://forms.example.com/r");
    expect(ctaFor("instagram", goal, "link")).not.toContain("https://");
  });
  it("refuses links that can't be shared", () => {
    expect(isShareableLink("http://example.com")).toBe(false);
    expect(isShareableLink("https://localhost/x")).toBe(false);
    expect(isShareableLink("https://10.0.0.1/x")).toBe(false);
    expect(isShareableLink("https://example.com/form")).toBe(true);
  });
  it("shows only the person's own number", () => {
    const base = {
      kind: "registrations" as const,
      target: 1000,
      link: null,
      linkLabel: "",
      countAt: null,
    };
    expect(goalLine({ ...base, count: null }).value).toBeNull();
    expect(goalLine({ ...base, count: 340 }).value).toBe("340 of 1,000");
  });
});

describe("sync", () => {
  const launch = playbookById("product-launch")!;
  const pieces = buildCampaignSkeleton(launch, brief(), [], TODAY).pieces;

  it("never touches a step that made its piece", () => {
    const steps = [
      { id: "a", status: "needs_approval" as const, pieceId: pieces[0].id, sig: "old" },
      { id: "b", status: "planned" as const, pieceId: pieces[1].id, sig: "old" },
      {
        id: "c",
        status: "planned" as const,
        pieceId: pieces[2].id,
        sig: pieceSignature(pieces[2]),
      },
      { id: "d", status: "planned" as const, pieceId: "gone-1", sig: "x" },
    ];
    const diff = diffPieces(pieces, steps);
    expect(diff.locked).toContain(pieces[0].id);
    expect(diff.cancel).toEqual(expect.arrayContaining(["b", "d"]));
    expect(diff.cancel).not.toContain("a");
    expect(diff.cancel).not.toContain("c");
    expect(diff.insert.map((p) => p.id)).toContain(pieces[1].id);
    expect(diff.insert.map((p) => p.id)).not.toContain(pieces[2].id);
    expect(diff.insert.map((p) => p.id)).not.toContain(pieces[0].id);
  });
});

describe("progress and prompts", () => {
  it("reads state from the step and counts only real views", () => {
    expect(pieceState(null)).toBe("idea");
    expect(pieceState("needs_approval")).toBe("waiting");
    const base = { actionId: null, contentIds: [], thumb: null, error: null };
    const p = buildCampaignSkeleton(
      playbookById("teach")!,
      brief({ type: "teach", keyDate: null }),
      [],
      TODAY,
    ).pieces[0];
    const progress = campaignProgress([
      { ...p, ...base, state: "out", views: 120 },
      { ...p, ...base, state: "out", views: null },
      { ...p, ...base, state: "waiting", views: null },
    ]);
    expect(progress).toMatchObject({ out: 2, waiting: 1, measured: 1, views: 120 });
    expect(
      currentPhase([{ id: "a", startsOn: "2026-11-05", endsOn: "2026-11-09" }], TODAY)?.id,
    ).toBe("a");
  });

  it("wraps the brief as data and gives Studio the phase's job", () => {
    const launch = playbookById("product-launch")!;
    const b = brief();
    const s = buildCampaignSkeleton(launch, b, [], TODAY);
    const user = planUserPrompt({
      playbook: launch,
      brief: b,
      pieces: s.pieces,
      phases: s.phases,
      brandText: "",
      productLines: [],
      mediaLines: [],
    });
    expect(user).toContain("<<<");
    expect(user).toContain(`[${s.pieces[0].id}]`);
    const plan = {
      v: 1 as const,
      bigIdea: "Light that waits.",
      phases: s.phases,
      pieces: s.pieces,
      written: true,
      rev: 0,
    };
    const text = pieceBrief({
      playbook: launch,
      brief: b,
      plan,
      piece: { ...s.pieces[0], title: "Hint", idea: "A hint of the lamp." },
    });
    expect(text).toContain("phase");
    expect(text).toContain("Light that waits.");
  });
});

describe("suggestions", () => {
  it("turns a season, a product and the goal into prefilled briefs, without repeats", () => {
    const out = suggestCampaigns({
      today: TODAY,
      moments: [
        {
          id: "bf-2026",
          name: "Black Friday",
          date: "2026-11-27",
          leadDays: 21,
          tags: ["retail"],
          angle: "Biggest shopping weekend.",
        },
      ],
      products: [{ id: "00000000-0000-4000-8000-000000000001", name: "Aurora", featured: false }],
      goalFocus: "leads",
      opportunities: [],
      roadmap: [],
      existing: [],
      channels: ["instagram"],
    });
    expect(out.find((s) => s.type === "sale")?.brief.keyDate).toBe("2026-11-27");
    expect(out.some((s) => s.type === "product-launch")).toBe(true);
    expect(out.some((s) => s.type === "lead-magnet")).toBe(true);
    expect(new Set(out.map((s) => s.id)).size).toBe(out.length);
  });
});
