"use client";

// /inspo-lab: Inspo's real screen with sample data, for visual checks in
// development (tests/integration/inspo-lab.spec.ts). Nothing here reaches a
// server; every handler writes its call into `lab-last`.
import { useEffect, useMemo, useState } from "react";
import { emptyDna, type BrandDna } from "@/hooks/use-brand-dna";
import type { BrandLookSpec } from "@/lib/brand-look/spec";
import {
  DirectionSchema,
  type VisualProfile,
  type VisualSource,
} from "@/lib/brand-visuals/contracts";
import { inspoCards, purposeOf } from "@/lib/inspo/board";
import { tidyLook } from "@/lib/inspo/look";
import { parseInspoSection, type InspoSection } from "@/lib/inspo/sections";
import { dsGhostBtn } from "@/components/app/surface/buttons";
import { cn } from "@/lib/utils";
import { InspoScreen } from "./InspoScreen";
import type { InspoHandlers, InspoTaste, InspoView } from "./types";

const WS = "00000000-0000-4000-8000-000000000099";

/** A small designed poster: soft light, a subject, and a headline that always fits. */
function art(w: number, h: number, bg: string, fg: string, word: string) {
  const m = Math.min(w, h);
  const size = Math.min(w * 0.11, (w * 0.84) / Math.max(4, word.length * 0.56));
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${bg}" stop-opacity="0.78"/></linearGradient>
        <radialGradient id="l" cx="0.3" cy="0.2" r="0.8"><stop offset="0" stop-color="#fff" stop-opacity="0.28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="${w}" height="${h}" fill="#111"/><rect width="${w}" height="${h}" fill="url(#g)"/>
      <circle cx="${w * 0.72}" cy="${h * 0.3}" r="${m * 0.34}" fill="${fg}" opacity="0.9"/>
      <ellipse cx="${w * 0.5}" cy="${h * 0.7}" rx="${m * 0.36}" ry="${m * 0.06}" fill="#000" opacity="0.18"/>
      <rect x="${w * 0.38}" y="${h * 0.38}" width="${m * 0.24}" height="${m * 0.3}" rx="${m * 0.05}" fill="#fff" opacity="0.92"/>
      <rect x="${w * 0.41}" y="${h * 0.44}" width="${m * 0.18}" height="${m * 0.025}" rx="${m * 0.012}" fill="${bg}" opacity="0.7"/>
      <rect width="${w}" height="${h}" fill="url(#l)"/>
      <rect x="${w * 0.08}" y="${h * 0.08}" width="${m * 0.16}" height="${m * 0.04}" rx="${m * 0.02}" fill="#fff" opacity="0.85"/>
      <text x="${w / 2}" y="${h * 0.88}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="800" letter-spacing="-1" font-size="${size}" fill="#fff">${word}</text>
    </svg>`,
  )}`;
}

const SAMPLES: Array<[VisualSource["purpose"], number, number, string, string, string]> = [
  ["style", 600, 750, "#1f3d2b", "#e9a23b", "Slow mornings"],
  ["inspiration", 600, 600, "#e9a23b", "#1f3d2b", "New roast"],
  ["style", 600, 900, "#2b2f77", "#b9c6ff", "Behind the bar"],
  ["avoid", 600, 600, "#777", "#bbb", "Stock smile"],
  ["style", 600, 520, "#f6f1e7", "#1f3d2b", "Weekend"],
  ["product", 600, 700, "#3a2a1f", "#cba66c", "Bag 250g"],
  ["person", 600, 800, "#495a45", "#f5f1e8", "Maya"],
];

function sampleSources(): VisualSource[] {
  return SAMPLES.map(([purpose, w, h, bg, fg, word], i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    workspace_id: WS,
    asset_id: `00000000-0000-4000-8000-${String(i + 101).padStart(12, "0")}`,
    kind: "upload",
    purpose,
    status: "approved",
    label: word,
    notes: "",
    formats: [],
    campaign: null,
    source_url: null,
    capture_job_id: null,
    region: {},
    created_at: new Date(Date.UTC(2026, 9, 20 - i)).toISOString(),
    asset: { storage_path: "lab", mime_type: "image/png", url: art(w, h, bg, fg, word) },
  }));
}

const direction = DirectionSchema.parse({
  name: "Quiet editorial",
  summary: "Warm textures, spacious layouts, serif headings.",
  visual: {
    medium: "photo",
    mood: "warm and calm",
    palette: { primary: "#1f3d2b", background: "#f6f1e7", text: "#1b1b1b", accent: "#e9a23b" },
    typography: { heading: "Fraunces", body: "Inter" },
  },
  sourceIds: ["00000000-0000-4000-8000-000000000001"],
});
const draftProfile: VisualProfile = {
  v: 1,
  selected: 0,
  coverage: [],
  warnings: [],
  observations: [],
  directions: [
    direction,
    { ...direction, name: "Product first", layout: "frame" },
    { ...direction, name: "Bold detail", layout: "bold", colorway: "dark" },
  ],
};

const sampleDna: BrandDna = {
  ...emptyDna,
  brandName: "Northside Roasters",
  websiteUrl: "https://example.com",
  colors: [
    { name: "Primary", hex: "#1f3d2b" },
    { name: "Accent", hex: "#e9a23b" },
    { name: "Background", hex: "#f6f1e7" },
    { name: "Text", hex: "#1b1b1b" },
  ],
  fonts: ["Fraunces", "Inter"],
};

const SCENES = [
  "board",
  "board-empty",
  "directions",
  "learning",
  "post",
  "video",
  "voice",
  "media",
] as const;
type Scene = (typeof SCENES)[number];

export function InspoLab() {
  const [scene, setScene] = useState<Scene>("board");
  const [section, setSection] = useState<InspoSection>("board");
  const [ready, setReady] = useState(false);
  const [dark, setDark] = useState(false);
  const [last, setLast] = useState("");
  const [sources, setSources] = useState<VisualSource[]>(sampleSources);
  const [look, setLook] = useState<BrandLookSpec>({});
  const [draft, setDraft] = useState<VisualProfile | null>(null);
  const [removedId, setRemovedId] = useState<string | null>(null);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("scene");
    const next = (SCENES as readonly string[]).includes(s ?? "") ? (s as Scene) : "board";
    pick(next);
    setReady(true);
  }, []);

  function pick(next: Scene) {
    setScene(next);
    setSection(parseInspoSection(next));
    setSources(next === "board-empty" ? [] : sampleSources());
    setDraft(next === "directions" ? draftProfile : null);
    setRemovedId(null);
  }

  const log = (s: string) => setLast(s);
  const cards = useMemo(() => inspoCards(sources), [sources]);
  const taste: InspoTaste = {
    available: true,
    canEdit: true,
    sources,
    draft: draft ? { id: "lab-draft", profile: draft } : null,
    active: scene === "board" ? { id: "lab-active", name: "Quiet editorial" } : null,
    running: scene === "learning" ? { stage: "analysing", pages: 0 } : null,
    lastError: null,
    learnPrice: scene === "board" ? 125 : 0,
  };
  const dna: BrandDna = { ...sampleDna, look };
  const view: InspoView = {
    dna,
    look,
    cards,
    taste,
    uploads: [],
    busy: null,
    error: null,
    removed: removedId
      ? (inspoCards(sampleSources()).find((c) => c.id === removedId) ?? null)
      : null,
  };

  const handlers: InspoHandlers = {
    onSection: (s) => {
      setSection(s);
      log(`section:${s}`);
    },
    saveLook: (next) => {
      setLook(tidyLook(next));
      log("look");
    },
    resetLook: () => {
      setLook({});
      log("reset");
    },
    upload: (files, chip) => log(`upload:${files.length}:${chip}`),
    addLink: (url, chip) => log(`link:${chip}:${url}`),
    setChip: (card, chip) => {
      setSources((list) =>
        list.map((s) => (s.id === card.id ? { ...s, purpose: purposeOf(chip, s.purpose) } : s)),
      );
      log(`chip:${card.label}:${chip}`);
    },
    remove: (card) => {
      setSources((list) => list.filter((s) => s.id !== card.id));
      setRemovedId(card.id);
      log(`remove:${card.label}`);
    },
    undo: () => {
      setSources(sampleSources());
      setRemovedId(null);
      log("undo");
    },
    learn: () => log("learn"),
    learnFromSite: () => log("learn-site"),
    pickDirection: (i) => {
      setDraft((d) => (d ? { ...d, selected: i } : d));
      log(`pick:${i}`);
    },
    useDirection: () => {
      setDraft(null);
      log("use-direction");
    },
    stopDirection: () => log("stop-direction"),
    useInPost: (card) => log(`use:${card.label}`),
    openBrand: (tab) => log(`brand:${tab ?? ""}`),
    dismissError: () => log("dismiss"),
  };

  return (
    <div
      data-mellox-app
      className={cn("min-h-screen bg-background text-foreground", dark && "dark")}
    >
      <div className="mx-auto max-w-[1280px] space-y-4 p-3 sm:p-6">
        <div className="flex flex-wrap items-center gap-1.5">
          {SCENES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => pick(s)}
              aria-pressed={scene === s}
              className={cn(dsGhostBtn, "h-8 px-3 text-[12px]", scene === s && "border-primary/60")}
            >
              {s}
            </button>
          ))}
          <button
            type="button"
            className={cn(dsGhostBtn, "h-8 px-3 text-[12px]")}
            onClick={() => setDark((d) => !d)}
          >
            {dark ? "Light" : "Dark"}
          </button>
          <span
            className="ml-auto font-mono text-[11px] text-muted-foreground"
            data-testid="lab-last"
          >
            {last}
          </span>
        </div>
        <div
          className="ds-window h-[min(860px,calc(100vh-120px))] overflow-hidden"
          data-testid="inspo-lab-frame"
        >
          {ready && <InspoScreen view={view} section={section} handlers={handlers} />}
        </div>
      </div>
    </div>
  );
}
