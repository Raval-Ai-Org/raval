// ONE canonical Brand-DNA → compact string serializer.
// Used by both the browser (ChatPanel) and server routes/functions so the
// model sees the same context shape regardless of caller. Skips empty
// fields entirely — no `(empty)` filler tokens.

export type BrandCtxDna = {
  brandName?: string | null;
  oneLiner?: string | null;
  about?: string | null;
  industry?: string | null;
  businessModel?: string | null;
  voice?: string | null;
  audience?: string | null;
  audienceTags?: string[] | null;
  values?: string | null;
  valueTags?: string[] | null;
  products?: string | null;
  doRules?: string | null;
  dontRules?: string | null;
  colors?: Array<{ name?: string; hex: string }> | null;
  fonts?: string[] | null;
  socials?: Array<{ platform: string; url: string }> | null;
  websiteUrl?: string | null;
  mission?: string | null;
  positioning?: string | null;
  uniqueValueProp?: string | null;
  userInsights?: Array<{ title: string; body: string }> | null;
  competitors?: Array<{ name: string; positioning?: string; url?: string }> | null;
  customer?: {
    personas?: Array<{ name: string }>;
    triggerSignals?: Array<{ text: string }>;
    objectionSignals?: Array<{ text: string }>;
    feedbackSources?: Array<{ text: string }>;
  } | null;
};

export type BrandCtxSignals = {
  pending?: number;
  scheduled?: number;
  published?: number;
  recentTitles?: string[];
} | null;

export type BrandCtxOpts = {
  siteUrl?: string | null;
  signals?: BrandCtxSignals;
  coachSummary?: string | null;
  competitorSummary?: string | null;
  /** Trim strategy for very long fields. */
  maxCharsPerField?: number;
};

const DEFAULT_MAX_CHARS = 400;

/**
 * Compact multi-line context string. Only includes fields with content.
 * Deterministic order so response cache hits are more common.
 */
export function serializeBrandContext(
  dna: BrandCtxDna | null | undefined,
  opts: BrandCtxOpts = {},
): string {
  const lines: string[] = [];
  const maxField = opts.maxCharsPerField ?? DEFAULT_MAX_CHARS;
  const clip = (s: unknown): string | null => {
    if (s == null) return null;
    const t = String(s).trim();
    if (!t) return null;
    return t.length > maxField ? `${t.slice(0, maxField)}…` : t;
  };
  const push = (label: string, value: unknown) => {
    const v = clip(value);
    if (v) lines.push(`- ${label}: ${v}`);
  };

  if (dna) {
    lines.push("## Brand DNA");
    push("Brand", dna.brandName);
    push("One-liner", dna.oneLiner);
    push("About", dna.about);
    push("Industry", dna.industry);
    push("Business model", dna.businessModel);
    push("Voice", dna.voice);
    push(
      "Audience",
      [
        dna.audience,
        dna.audienceTags?.length ? `tags: ${dna.audienceTags.slice(0, 6).join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" | "),
    );
    push(
      "Values",
      [dna.values, dna.valueTags?.length ? `tags: ${dna.valueTags.slice(0, 6).join(", ")}` : ""]
        .filter(Boolean)
        .join(" | "),
    );
    push("Products", dna.products);
    push("Do", dna.doRules);
    push("Don't", dna.dontRules);
    if (dna.colors?.length) {
      push(
        "Colors",
        dna.colors
          .slice(0, 4)
          .map((c) => `${c.name ?? "Color"} ${c.hex}`)
          .join(", "),
      );
    }
    if (dna.fonts?.length) push("Fonts", dna.fonts.slice(0, 3).join(", "));
    push("Website", opts.siteUrl || dna.websiteUrl);
    push("USP", dna.uniqueValueProp);
    push("Positioning", dna.positioning);
    push("Mission", dna.mission);

    if (dna.userInsights?.length) {
      lines.push("");
      lines.push("## Operator-stated insights (respect these)");
      dna.userInsights
        .slice(0, 10)
        .forEach((n) => lines.push(`- ${n.title}: ${clip(n.body) ?? ""}`));
    }

    if (dna.competitors?.length) {
      lines.push("");
      lines.push("## Competitors");
      dna.competitors
        .slice(0, 6)
        .forEach((c) =>
          lines.push(`- ${c.name}${c.positioning ? ` — ${clip(c.positioning)}` : ""}`),
        );
    }

    const cs = dna.customer;
    if (cs && (cs.personas?.length || cs.triggerSignals?.length || cs.objectionSignals?.length)) {
      lines.push("");
      lines.push("## Customer signals");
      if (cs.personas?.length)
        lines.push(
          `- Personas: ${cs.personas
            .slice(0, 4)
            .map((p) => p.name)
            .join(", ")}`,
        );
      if (cs.triggerSignals?.length)
        lines.push(
          `- Triggers: ${cs.triggerSignals
            .slice(0, 4)
            .map((s) => s.text)
            .join(" | ")}`,
        );
      if (cs.objectionSignals?.length)
        lines.push(
          `- Objections: ${cs.objectionSignals
            .slice(0, 4)
            .map((s) => s.text)
            .join(" | ")}`,
        );
    }
  }

  const sig = opts.signals;
  if (sig && (sig.pending || sig.scheduled || sig.published || sig.recentTitles?.length)) {
    lines.push("");
    lines.push("## Workspace activity");
    if (sig.pending) lines.push(`- Pending approvals: ${sig.pending}`);
    if (sig.scheduled) lines.push(`- Scheduled: ${sig.scheduled}`);
    if (sig.published) lines.push(`- Published recently: ${sig.published}`);
    if (sig.recentTitles?.length)
      lines.push(`- Recent: ${sig.recentTitles.slice(0, 4).join(" • ")}`);
  }

  if (opts.coachSummary) {
    lines.push("");
    lines.push("## Coach briefing");
    lines.push(String(opts.coachSummary).slice(0, 600));
  }
  if (opts.competitorSummary) {
    lines.push("");
    lines.push("## Competitor alerts");
    lines.push(String(opts.competitorSummary).slice(0, 500));
  }

  return lines.join("\n");
}

/**
 * Ultra-compact single-line context for lightweight prompts (clarify, tools).
 * Only the fields that actually change the model's answer.
 */
export function compactBrandTagline(
  dna: BrandCtxDna | null | undefined,
  siteUrl?: string | null,
): string {
  if (!dna) return "";
  const bits: string[] = [];
  if (dna.brandName) bits.push(`brand=${dna.brandName}`);
  if (dna.oneLiner) bits.push(`oneLiner=${dna.oneLiner.slice(0, 120)}`);
  if (dna.voice) bits.push(`voice=${dna.voice.slice(0, 80)}`);
  if (dna.audience) bits.push(`audience=${dna.audience.slice(0, 100)}`);
  if (siteUrl) bits.push(`site=${siteUrl}`);
  return bits.join(" | ");
}
