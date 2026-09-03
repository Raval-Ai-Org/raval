"use client";

// Focused editor for the 5 Brand DNA essentials with a live post preview.
// Data flows through the existing useBrandDna hook (no new storage).

import { useMemo, useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  Users,
  Megaphone,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
} from "@/components/ui/gemini-icons";
import { cn } from "@/lib/utils";
import type { BrandDna } from "@/hooks/use-brand-dna";
import { getBrandVisualSystem } from "@/lib/post-image";

type FieldKey = "audience" | "voice" | "values" | "doRules" | "dontRules";

const FIELDS: {
  key: FieldKey;
  label: string;
  hint: string;
  placeholder: string;
  icon: any;
  accent?: "green" | "red";
}[] = [
  {
    key: "audience",
    label: "Who you're for",
    hint: "One sentence naming the person you write for.",
    placeholder: "Early-stage B2B founders scaling from $0 → $1M ARR",
    icon: Users,
  },
  {
    key: "voice",
    label: "Voice & tone",
    hint: "How you sound: 3–5 adjectives + a short example.",
    placeholder: "Direct, confident, warm. Short sentences. No jargon.",
    icon: Megaphone,
  },
  {
    key: "values",
    label: "Core values",
    hint: "Comma-separated. What the brand stands for.",
    placeholder: "Craft, Speed, Honesty, Optimism",
    icon: ShieldCheck,
  },
  {
    key: "doRules",
    label: "Always do",
    hint: "Non-negotiable behaviours in every post.",
    placeholder: "Lead with a real customer moment. Cite numbers.",
    icon: CheckCircle2,
    accent: "green",
  },
  {
    key: "dontRules",
    label: "Never do",
    hint: "Hard no's — Ravi will avoid these forever.",
    placeholder: "No hype words. No emoji spam. No competitor bashing.",
    icon: AlertTriangle,
    accent: "red",
  },
];

export function BrandDnaEditor({
  dna,
  save,
  workspaceName,
}: {
  dna: BrandDna;
  save: (patch: Partial<BrandDna>) => void;
  workspaceName?: string | null;
}) {
  // Local buffer for smooth typing; commit to store on blur (autosave).
  const [buffer, setBuffer] = useState<Record<FieldKey, string>>(() => ({
    audience: dna.audience ?? "",
    voice: dna.voice ?? "",
    values: dna.values ?? "",
    doRules: dna.doRules ?? "",
    dontRules: dna.dontRules ?? "",
  }));

  // Sync from external changes (e.g. AI extract) without stomping in-progress edits.
  const focusedRef = useRef<FieldKey | null>(null);
  useEffect(() => {
    setBuffer((prev) => {
      const next = { ...prev };
      for (const f of FIELDS) {
        if (focusedRef.current === f.key) continue;
        const v = (dna[f.key] as string) ?? "";
        if (v !== prev[f.key]) next[f.key] = v;
      }
      return next;
    });
  }, [dna.audience, dna.voice, dna.values, dna.doRules, dna.dontRules]);

  const filled = FIELDS.filter((f) => buffer[f.key].trim().length > 0).length;
  const pct = Math.round((filled / FIELDS.length) * 100);

  return (
    <div className="space-y-6">
      {/* LEFT — Checklist editor */}
      <div className="min-w-0 space-y-4">
        {/* Progress — compact inline bar */}
        <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card/60 px-4 py-2.5">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
            <motion.div
              initial={false}
              animate={{ width: `${pct}%` }}
              transition={{ type: "spring", stiffness: 140, damping: 22 }}
              className="h-full rounded-full"
              style={{
                background: "linear-gradient(90deg, hsl(var(--brand-green)), hsl(220 90% 60%))",
              }}
            />
          </div>
          <span className="shrink-0 whitespace-nowrap rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-medium leading-4 tabular-nums text-foreground">
            {filled} / {FIELDS.length}
          </span>
        </div>

        {/* Fields */}
        <div className="space-y-3">
          {FIELDS.map((f) => {
            const Icon = f.icon;
            const value = buffer[f.key];
            const isFilled = value.trim().length > 0;
            return (
              <div
                key={f.key}
                className={cn(
                  "group rounded-2xl border bg-card/40 p-4 sm:p-5 transition-colors",
                  isFilled
                    ? "border-border/70"
                    : "border-dashed border-border/50 hover:border-border",
                )}
              >
                <div className="flex items-start gap-3 sm:gap-4">
                  <span
                    className={cn(
                      "mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1 transition-colors",
                      isFilled
                        ? f.accent === "red"
                          ? "bg-rose-500/10 text-rose-600 ring-rose-500/25 dark:text-rose-300"
                          : "bg-emerald-500/10 text-emerald-600 ring-emerald-500/25 dark:text-emerald-300"
                        : "bg-secondary/60 text-muted-foreground ring-border/60",
                    )}
                  >
                    {isFilled ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                      <label
                        htmlFor={`bde-${f.key}`}
                        className="min-w-0 flex-1 break-words text-[14px] font-semibold leading-5 text-foreground"
                      >
                        {f.label}
                      </label>
                      <span
                        className={cn(
                          "shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase leading-4 tracking-wide",
                          isFilled
                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            : "bg-secondary/70 text-muted-foreground",
                        )}
                      >
                        {isFilled ? "Done" : "Empty"}
                      </span>
                    </div>
                    <p className="mt-1 break-words text-[12.5px] leading-5 text-muted-foreground">
                      {f.hint}
                    </p>
                    <textarea
                      id={`bde-${f.key}`}
                      value={value}
                      placeholder={f.placeholder}
                      rows={2}
                      onFocus={() => {
                        focusedRef.current = f.key;
                      }}
                      onChange={(e) => setBuffer((b) => ({ ...b, [f.key]: e.target.value }))}
                      onBlur={() => {
                        focusedRef.current = null;
                        const v = buffer[f.key].trim();
                        if (v !== (dna[f.key] ?? "")) save({ [f.key]: v } as Partial<BrandDna>);
                      }}
                      className="mt-3 w-full resize-none rounded-xl bg-secondary/50 px-3.5 py-2.5 text-[14px] leading-6 text-foreground outline-none ring-1 ring-transparent placeholder:text-muted-foreground/60 focus:bg-background focus:ring-border"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* RIGHT — Live preview */}
      <div className="min-w-0 xl:sticky xl:top-2 xl:self-start">
        <div className="mb-2 flex items-center gap-2 px-1">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-brand-green" />
          <p className="text-[11px] font-semibold uppercase leading-4 tracking-wide text-muted-foreground">
            Live preview
          </p>
        </div>
        <LivePostPreview dna={dna} buffer={buffer} workspaceName={workspaceName} />
        <p className="mt-2 px-1 text-[12.5px] leading-5 text-muted-foreground">
          This is how Ravi will style your posts. Palette, type and layout update as you type.
        </p>
      </div>
    </div>
  );
}

/* ---------------- Live post preview ---------------- */

function LivePostPreview({
  dna,
  buffer,
  workspaceName,
}: {
  dna: BrandDna;
  buffer: Record<FieldKey, string>;
  workspaceName?: string | null;
}) {
  // Deterministic seed → same visual language as the image generator.
  const seedKey = `preview:${dna.brandName || workspaceName || "brand"}`;
  const vis = useMemo(
    () =>
      getBrandVisualSystem(
        { ...dna, voice: buffer.voice, audience: buffer.audience, values: buffer.values },
        seedKey,
        workspaceName,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dna.brandName, dna.industry, buffer.voice, workspaceName],
  );

  // Prefer real brand colors when the extractor found them.
  const brandAccent = dna.colors?.[0]?.hex || vis.palette.accent;
  const brandName = dna.brandName || workspaceName || "Your brand";
  const initials = brandName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  const values = (buffer.values || "")
    .split(/[,·|]/)
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 3);
  const audience = buffer.audience.trim();
  const voice = buffer.voice.trim();
  const doRule = firstClause(buffer.doRules);
  const dontRule = firstClause(buffer.dontRules);
  const hook = deriveHook(voice, audience);

  const { palette, typography } = vis;

  return (
    <motion.div
      layout
      transition={{ layout: { duration: 0.25 } }}
      className="mx-auto w-full max-w-[420px] overflow-hidden rounded-2xl ring-1 ring-border/60 shadow-xl"
      style={{ background: palette.bg }}
    >
      {/* Post chrome — mimics an IG-style card */}
      <div
        className="flex items-center gap-2.5 px-3.5 py-2.5"
        style={{ background: palette.surface }}
      >
        <div
          className="grid h-8 w-8 place-items-center rounded-full text-[11px] font-bold"
          style={{
            background: `linear-gradient(135deg, ${brandAccent}, ${palette.fg})`,
            color: "#fff",
          }}
        >
          {dna.logoUrl ? (
            <img
              src={dna.logoUrl}
              alt={brandName}
              className="h-full w-full rounded-full object-cover"
            />
          ) : (
            <span>{initials || "?"}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-[12px] font-semibold leading-4"
            style={{ color: palette.fg }}
            title={brandName}
          >
            {brandName}
          </p>
          <p className="truncate text-[10.5px] leading-4" style={{ color: palette.muted }}>
            Sponsored · Just now
          </p>
        </div>
      </div>

      {/* Image surface — square, on-brand */}
      <div
        className="relative aspect-square w-full overflow-hidden"
        style={{
          background: `radial-gradient(120% 90% at 20% 10%, ${withAlpha(brandAccent, 0.35)} 0%, ${palette.bg} 55%)`,
        }}
      >
        {/* Decorative geometric accent — deterministic per brand seed */}
        <div
          aria-hidden
          className="absolute -right-16 -top-16 h-56 w-56 rounded-full opacity-70 blur-2xl"
          style={{ background: brandAccent }}
        />
        <div
          aria-hidden
          className="absolute -bottom-24 -left-10 h-64 w-64 rounded-full opacity-40 blur-3xl"
          style={{ background: palette.fg }}
        />

        <div className="relative z-10 flex h-full flex-col justify-between p-6">
          <div>
            <span
              className="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide"
              style={{
                background: withAlpha(palette.surface, 0.14),
                color: palette.surface,
                backdropFilter: "blur(6px)",
              }}
            >
              {audience ? `For ${clampWords(audience, 4)}` : "For your people"}
            </span>
          </div>

          <div className="space-y-3">
            <h3
              className="text-[26px] leading-[1.05]"
              style={{
                color: contrastOn(palette.bg),
                fontFamily: typography.fontFamily,
                fontWeight: typography.weight,
                letterSpacing: typography.tracking,
              }}
            >
              {hook}
            </h3>
            {values.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {values.map((v) => (
                  <span
                    key={v}
                    className="max-w-full truncate rounded-full px-2 py-0.5 text-[10.5px] font-medium leading-4"
                    style={{
                      background: withAlpha(brandAccent, 0.9),
                      color: contrastOn(brandAccent),
                    }}
                    title={v}
                  >
                    {clampWords(v, 3)}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Caption / rules footer */}
      <div className="space-y-2 px-3.5 py-3" style={{ background: palette.surface }}>
        <p className="text-[12.5px] leading-snug" style={{ color: palette.fg }}>
          <span className="font-semibold">{brandName}</span>{" "}
          {voice
            ? sampleCaption(voice, audience)
            : "Add a voice to see this caption written in your tone."}
        </p>
        {(doRule || dontRule) && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {doRule && (
              <span
                className="inline-flex max-w-full items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-4 text-emerald-700 dark:text-emerald-300"
                title={doRule}
              >
                <CheckCircle2 className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{clampWords(doRule, 6)}</span>
              </span>
            )}
            {dontRule && (
              <span
                className="inline-flex max-w-full items-center gap-1 rounded-md bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-4 text-rose-700 dark:text-rose-300"
                title={dontRule}
              >
                <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">No {clampWords(dontRule, 5)}</span>
              </span>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

/* ---------------- Helpers ---------------- */

function firstClause(s: string): string {
  const raw = (s || "").trim();
  if (!raw) return "";
  return raw.split(/[.\n·|]/)[0].trim();
}

function clampWords(s: string, n: number): string {
  const words = s.split(/\s+/).filter(Boolean);
  return words.slice(0, n).join(" ") + (words.length > n ? "…" : "");
}

function deriveHook(voice: string, audience: string): string {
  const v = voice.toLowerCase();
  const aud = audience ? clampWords(audience, 3) : "founders";
  if (/(punchy|bold|direct|confident|sharp)/.test(v)) return `Stop guessing.\nStart shipping.`;
  if (/(warm|friendly|human|consultative|approachable)/.test(v))
    return `A better way\nto reach ${aud}.`;
  if (/(playful|witty|fun|clever)/.test(v)) return `Marketing that\nactually lands.`;
  if (/(premium|luxury|elevated|refined)/.test(v)) return `Crafted for the\nfew who notice.`;
  return `Meet your\nnext unfair edge.`;
}

function sampleCaption(voice: string, audience: string): string {
  const v = voice.toLowerCase();
  const aud = audience ? clampWords(audience, 4) : "your audience";
  if (/(punchy|bold|direct|confident)/.test(v))
    return `Built for ${aud}. No fluff, no filler — just results you can measure this week.`;
  if (/(warm|friendly|human|consultative)/.test(v))
    return `We spend our days thinking about ${aud}. Here's the one thing we wish more people understood.`;
  if (/(playful|witty|fun|clever)/.test(v))
    return `Ok but seriously — ${aud} deserve better than yet another dashboard. Here's what we're doing about it. ↓`;
  if (/(premium|luxury|elevated|refined)/.test(v))
    return `Considered work for ${aud} who care about the details. A small note on what we shipped this week.`;
  return `A quick note for ${aud} — the pattern we keep seeing, and the small change that fixes it.`;
}

function withAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function contrastOn(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150 ? "#0B0B0E" : "#FFFFFF";
}
