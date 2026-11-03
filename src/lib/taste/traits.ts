// What a piece was made with, read only from what Studio stored on its
// content row and its job. Never from the browser, never from a model.

import { TRAIT_KINDS, type Traits, type TraitKind } from "./contracts";

type Obj = Record<string, unknown>;

const ID = /^[a-z0-9][a-z0-9:_.-]{0,59}$/i;

function obj(value: unknown): Obj {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : {};
}

function id(value: unknown): string | undefined {
  return typeof value === "string" && ID.test(value.trim()) ? value.trim() : undefined;
}

export type TraitSource = {
  /** content_items.meta, or assets.metadata for media without a post. */
  meta?: Obj | null;
  channel?: string | null;
  kind?: string | null;
  /** The Studio job row (studio_jobs) the piece came from, if any. */
  job?: { type?: string | null; input?: unknown; output?: unknown } | null;
};

export function traitsOf(src: TraitSource): Traits {
  const meta = obj(src.meta);
  const input = obj(src.job?.input);
  const output = obj(src.job?.output);
  const intent = obj(input.intent);
  const controls = obj(input.controls);
  const carousel = { ...obj(output.carousel), ...obj(meta.carousel) };
  const story = obj(meta.story);
  const storySpec = obj(story.spec);
  const design = {
    ...obj(obj(output.carousel).design),
    ...obj(obj(obj(output.story).spec).design),
    ...obj(carousel.design),
    ...obj(storySpec.design),
  };
  const platforms = Array.isArray(controls.platforms) ? controls.platforms : [];

  const raw: Record<TraitKind, unknown> = {
    format: meta.studio_type ?? src.job?.type,
    platform: meta.platform ?? src.channel ?? platforms[0],
    aim: intent.aim,
    hook: meta.hook_style ?? intent.hookStyle,
    angle: meta.angle,
    adFormat: meta.ad_format ?? output.adFormat,
    layout: output.artDirection,
    colorway: design.colorway,
    motif: design.motif,
    structure: carousel.structure,
    storyTheme: story.theme ?? obj(output.story).theme,
    ratio: meta.aspect_ratio ?? controls.ratio,
  };
  const out: Traits = {};
  for (const [kind, value] of Object.entries(raw) as [TraitKind, unknown][]) {
    const v = id(value);
    if (v) out[kind] = v;
  }
  return out;
}

/** Stored traits back from jsonb: only known kinds with id-shaped values. */
export function parseTraits(value: unknown): Traits {
  const o = obj(value);
  const out: Traits = {};
  for (const [kind, v] of Object.entries(o)) {
    const clean = id(v);
    if (clean && (TRAIT_KINDS as readonly string[]).includes(kind)) out[kind as TraitKind] = clean;
  }
  return out;
}
