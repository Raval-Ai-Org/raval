"use client";

import { useState, type ReactNode, type Ref } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Pencil, Plus } from "@/components/icons";
import type { BrandExtractResult } from "@/lib/brand-extract-events";
import { BRAINS, BRAIN_META, type BrainId } from "@/lib/brain/brain";
import { cn } from "@/lib/utils";
import type { BrandEdits, EditableField } from "../BrandReveal";
import { LanguageGrid } from "../LanguageStep";
import { BrandMark } from "../ui";
import { hostOf } from "../url";
import { BrainRing } from "./ScanDock";
import { Highlighted, poseSrc } from "./text";

/** A step's heading: one line, one **highlighted** part, Mox beside it. */
export function StepHead({
  title,
  sub,
  pose,
  reduce,
  headingRef,
}: {
  title: string;
  sub?: string;
  pose?: string;
  reduce: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <div className="flex shrink-0 items-center justify-center gap-3 px-2">
      {pose && (
        <motion.img
          src={poseSrc(pose)}
          alt=""
          draggable={false}
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6, rotate: -8 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 16 }}
          className={cn("h-14 w-auto shrink-0 object-contain sm:h-20", !reduce && "ob-mox-idle")}
        />
      )}
      <div className={pose ? "text-left" : "text-center"}>
        <h1 ref={headingRef} tabIndex={-1} className="ob-title outline-none">
          <Highlighted text={title} />
        </h1>
        {sub && <p className="mt-1 text-[13px] text-muted-foreground sm:text-[14px]">{sub}</p>}
      </div>
    </div>
  );
}

/* ── The brand, as Mox sees it ─────────────────────────────────────────── */

const CARD_FIELDS: { key: EditableField; label: string }[] = [
  { key: "oneLiner", label: "What you do" },
  { key: "audience", label: "Who it's for" },
  { key: "voice", label: "How you sound" },
  { key: "industry", label: "Industry" },
];

/**
 * One card that fits the screen: logo, name, colours and four lines. A tap on
 * a line edits it in place; nothing here scrolls the page.
 */
export function BrandCard({
  brand,
  url,
  reduce,
  headingRef,
  onChange,
}: {
  brand: BrandExtractResult;
  url: string;
  reduce: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  onChange: (patch: BrandEdits) => void;
}) {
  const [editing, setEditing] = useState<EditableField | null>(null);
  const name = brand.brandName?.trim() || hostOf(url);
  const colors = (brand.colors ?? []).slice(0, 5);
  return (
    <div className="flex h-full min-h-0 flex-col items-center">
      <StepHead
        title={`Here's **${name}**, as Mox sees it`}
        sub="Tap a line to fix it."
        reduce={reduce}
        headingRef={headingRef}
      />
      <div className="flex min-h-0 w-full flex-1 items-center justify-center pt-3 sm:pt-5">
        <motion.div
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 30, rotateX: 18, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, rotateX: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 180, damping: 22 }}
          style={{ transformPerspective: 900 }}
          className="ob-card relative flex max-h-full w-full max-w-[560px] flex-col overflow-hidden rounded-[28px] p-4 sm:p-5"
        >
          <div className="flex items-center gap-3">
            <BrandMark sources={[brand.logoUrl, brand.faviconUrl]} name={name} size={52} />
            <div className="min-w-0 flex-1">
              <EditableLine
                value={brand.brandName ?? ""}
                placeholder="Brand name"
                editing={editing === "brandName"}
                onEdit={() => setEditing("brandName")}
                onDone={(v) => {
                  onChange({ brandName: v });
                  setEditing(null);
                }}
                className="text-[18px] font-semibold"
              />
              <p className="truncate text-[12px] text-muted-foreground">{hostOf(url)}</p>
            </div>
            {colors.length > 0 && (
              <div className="flex -space-x-1.5">
                {colors.map((c, i) => (
                  <motion.span
                    key={c.hex}
                    title={c.name}
                    initial={reduce ? false : { scale: 0, y: 6 }}
                    animate={{ scale: 1, y: 0 }}
                    transition={{
                      delay: 0.25 + i * 0.06,
                      type: "spring",
                      stiffness: 420,
                      damping: 18,
                    }}
                    className="size-6 rounded-full border-2 border-card shadow-sm"
                    style={{ background: c.hex }}
                  />
                ))}
              </div>
            )}
          </div>
          <ul className="mt-3 min-h-0 divide-y divide-border/60 overflow-y-auto">
            {CARD_FIELDS.map((f, i) => (
              <motion.li
                key={f.key}
                initial={reduce ? false : { opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + i * 0.07 }}
                className="py-2.5"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  {f.label}
                </p>
                <EditableLine
                  value={brand[f.key] ?? ""}
                  placeholder="Not found on your site — add it"
                  editing={editing === f.key}
                  multiline
                  onEdit={() => setEditing(f.key)}
                  onDone={(v) => {
                    onChange({ [f.key]: v });
                    setEditing(null);
                  }}
                  className="text-[14px] leading-snug"
                />
              </motion.li>
            ))}
          </ul>
        </motion.div>
      </div>
    </div>
  );
}

function EditableLine({
  value,
  placeholder,
  editing,
  multiline,
  className,
  onEdit,
  onDone,
}: {
  value: string;
  placeholder: string;
  editing: boolean;
  multiline?: boolean;
  className?: string;
  onEdit: () => void;
  onDone: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  if (editing) {
    const common = {
      autoFocus: true,
      value: draft,
      onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
      onBlur: () => onDone(draft.trim()),
      onKeyDown: (e: React.KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onDone(draft.trim());
        }
        if (e.key === "Escape") onDone(value);
      },
      className: cn(
        "w-full rounded-xl bg-[var(--ds-well-bg)] px-2 py-1 outline-none ring-2 ring-primary/40",
        className,
      ),
    };
    return multiline ? (
      <textarea rows={2} {...common} className={cn(common.className, "resize-none")} />
    ) : (
      <input {...common} />
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value);
        onEdit();
      }}
      className={cn(
        "group flex w-full items-start gap-2 rounded-xl text-left transition hover:bg-[var(--ds-well-bg)]",
        className,
      )}
    >
      <span className={cn("line-clamp-2 min-w-0 flex-1", !value && "text-muted-foreground")}>
        {value || placeholder}
      </span>
      <Pencil
        className="mt-1 size-3.5 shrink-0 opacity-0 transition group-hover:opacity-60"
        aria-hidden
      />
    </button>
  );
}

/* ── Who it's for ──────────────────────────────────────────────────────── */

/** The audience the scan heard, as cards; the picked ones become Brand DNA's audience. */
export function AudiencePick({
  options,
  value,
  reduce,
  headingRef,
  onChange,
}: {
  options: string[];
  value: string[];
  reduce: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  onChange: (next: string[]) => void;
}) {
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const extra = value.filter((v) => !options.includes(v));
  const all = [...options, ...extra];
  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div className="flex h-full min-h-0 flex-col items-center">
      <StepHead
        title="Who are you **talking to**?"
        sub="Mox found these on your site. Keep the ones that are right."
        pose="pose-thinking"
        reduce={reduce}
        headingRef={headingRef}
      />
      <div className="flex min-h-0 w-full flex-1 items-center justify-center pt-4">
        <div className="grid max-h-full w-full max-w-[640px] grid-cols-1 gap-2.5 overflow-y-auto p-1 sm:grid-cols-2">
          {all.map((o, i) => {
            const on = value.includes(o);
            return (
              <motion.button
                key={o}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(o)}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{
                  delay: reduce ? 0 : i * 0.05,
                  type: "spring",
                  stiffness: 300,
                  damping: 24,
                }}
                whileTap={reduce ? undefined : { scale: 0.97 }}
                className={cn(
                  "ob-card flex items-center gap-3 rounded-full py-2.5 pl-3 pr-4 text-left",
                  on && "ob-card-on",
                )}
              >
                <span
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-full transition",
                    on
                      ? "bg-primary text-primary-foreground"
                      : "bg-[var(--ds-well-bg)] text-transparent",
                  )}
                >
                  <Check className="size-3.5" strokeWidth={3} aria-hidden />
                </span>
                <span className="line-clamp-2 text-[13.5px] font-medium leading-snug">{o}</span>
              </motion.button>
            );
          })}
          {typing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const v = draft.trim().slice(0, 120);
                if (v && !all.includes(v)) onChange([...value, v]);
                setDraft("");
                setTyping(false);
              }}
              className="ob-card flex items-center gap-2 rounded-full py-1.5 pl-4 pr-1.5"
            >
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder="e.g. busy parents in Leeds"
                aria-label="Someone else"
                className="h-9 min-w-0 flex-1 bg-transparent text-[13.5px] outline-none"
              />
              <button
                type="submit"
                className="h-9 rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground"
              >
                Add
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setTyping(true)}
              className="flex items-center gap-3 rounded-full border border-dashed border-border py-2.5 pl-3 pr-4 text-left text-[13.5px] text-muted-foreground transition hover:border-foreground/30 hover:text-foreground"
            >
              <span className="grid size-7 place-items-center rounded-full bg-[var(--ds-well-bg)]">
                <Plus className="size-3.5" aria-hidden />
              </span>
              Someone else
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Language ──────────────────────────────────────────────────────────── */

export function LanguagePick({
  value,
  reduce,
  headingRef,
  onChange,
}: {
  value: string;
  reduce: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  onChange: (language: string) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center">
      <StepHead
        title="Which language should Mox **write in**?"
        sub={`${value} is picked. The app itself stays in English.`}
        pose="tone-personal"
        reduce={reduce}
        headingRef={headingRef}
      />
      <LanguageGrid
        value={value}
        onChange={onChange}
        className="mt-4 flex min-h-0 w-full max-w-[720px] flex-1 flex-col"
        listClassName="min-h-0 flex-1"
      />
    </div>
  );
}

/* ── Connect (optional) ────────────────────────────────────────────────── */

export function ConnectStep({
  reduce,
  headingRef,
  children,
}: {
  reduce: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center">
      <StepHead
        title="Where should your posts **go**?"
        sub="Optional. Mox only posts what you approve."
        pose="pose-thumbs"
        reduce={reduce}
        headingRef={headingRef}
      />
      <div className="mt-4 min-h-0 w-full max-w-[760px] flex-1 overflow-y-auto overscroll-contain px-1 pb-2">
        {children}
      </div>
    </div>
  );
}

/* ── Done ──────────────────────────────────────────────────────────────── */

export type Learned = Partial<Record<BrainId, string>>;

/**
 * The four brains assemble around Mox with one thing each learned, then the
 * press-and-hold goes in. Nothing is made or charged here.
 */
export function DoneBrains({ learned, reduce }: { learned: Learned; reduce: boolean }) {
  return (
    <ul className="grid w-full max-w-[460px] grid-cols-2 gap-2">
      {BRAINS.map((b, i) => (
        <motion.li
          key={b}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{
            delay: reduce ? 0 : 0.45 + i * 0.1,
            type: "spring",
            stiffness: 210,
            damping: 24,
          }}
          className="ob-glass flex min-w-0 items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 text-left"
        >
          <BrainRing brain={b} value={1} size={30} reduce={reduce} delay={0.5 + i * 0.12} />
          <span className="min-w-0">
            <span className="block text-[12px] font-semibold leading-tight">
              {BRAIN_META[b].label}
            </span>
            <span className="block truncate text-[10.5px] leading-tight text-muted-foreground">
              {learned[b] || BRAIN_META[b].blurb}
            </span>
          </span>
        </motion.li>
      ))}
    </ul>
  );
}

/** The answer trail: small chips under the progress line, one per answer. */
export function AnswerTrail({
  chips,
  reduce,
}: {
  chips: { id: string; label: string; art?: ReactNode }[];
  reduce: boolean;
}) {
  return (
    <div aria-hidden className="flex h-8 items-center justify-center gap-1.5 overflow-hidden px-4">
      <AnimatePresence initial={false}>
        {chips.slice(-5).map((c, i, all) => (
          <motion.span
            key={c.id}
            layout
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.5, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ type: "spring", stiffness: 380, damping: 26 }}
            className={cn(
              "ob-glass inline-flex h-7 max-w-[140px] shrink-0 items-center gap-1.5 rounded-full pl-1 pr-2.5 text-[11px] font-medium",
              i < all.length - 2 && "max-sm:hidden",
            )}
          >
            {c.art ? (
              <motion.span
                layoutId={reduce ? undefined : `ob-answer-${c.id}`}
                className="block size-5 overflow-hidden rounded-full bg-[var(--ds-well-bg)]"
              >
                {c.art}
              </motion.span>
            ) : (
              <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                <Check className="size-3" strokeWidth={3} />
              </span>
            )}
            <span className="truncate">{c.label}</span>
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}
