"use client";

// Inspo → Board: everything the brand likes and wants to avoid, as one wall.
import * as React from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { ArrowRight, Check, Globe, Monitor, Sparkles, Spinner } from "@/components/icons";
import { dsFocus, dsGhostBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import {
  BOARD_CHIPS,
  canLearn,
  shelfCards,
  siteDesignCards,
  type InspoCard,
  type InspoChip,
} from "@/lib/inspo/board";
import type { InspoSection } from "@/lib/inspo/sections";
import type { StrengthStep } from "@/lib/inspo/strength";
import { cn } from "@/lib/utils";
import { BibleNotes, DirectionArt } from "./DirectionCard";

const ADHERENCE_LABEL = { light: "Light", close: "Close", strict: "Strict" } as const;

/** How closely pictures follow the learned style. Light is the default. */
function AdherencePill({
  value,
  disabled,
  onChange,
}: {
  value: "light" | "close" | "strict";
  disabled: boolean;
  onChange: (level: "light" | "close" | "strict") => void;
}) {
  return (
    <div
      className="ds-well inline-flex p-0.5"
      role="radiogroup"
      aria-label="How closely posts follow this style"
      title="Light keeps your world and type and varies the layout. Strict follows your examples' layout too."
    >
      {(["light", "close", "strict"] as const).map((level) => (
        <button
          key={level}
          type="button"
          role="radio"
          aria-checked={value === level}
          disabled={disabled}
          onClick={() => onChange(level)}
          className={cn(
            "h-7 rounded-full px-3 text-[12px] font-semibold transition-colors",
            value === level
              ? "bg-[var(--ds-tile-bg)] text-foreground shadow-sm ring-1 ring-primary/30"
              : "text-muted-foreground hover:text-foreground",
            dsFocus,
          )}
        >
          {ADHERENCE_LABEL[level]}
        </button>
      ))}
    </div>
  );
}
import { CardWall, EASE, InspoCardView, InspoDrop, StrengthRing, UploadCardView } from "./parts";
import type { InspoHandlers, InspoView } from "./types";

type Filter = "all" | "like" | "avoid";

/**
 * "Your website's design": the screenshots Mox took of the brand's own site
 * (the whole page, its hero, sections and artwork), shown as they are. With
 * the Custom look every picture follows this design.
 */
function SiteDesignStrip({
  cards,
  following,
  canEdit,
  onRemove,
}: {
  cards: InspoCard[];
  following: boolean;
  canEdit: boolean;
  onRemove: (card: InspoCard) => void;
}) {
  if (!cards.length) return null;
  return (
    <div
      className="rounded-[28px] bg-[var(--ds-tile-bg)] p-4 ring-1 ring-[var(--ds-tile-border)] sm:p-5"
      data-testid="inspo-site-design"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="flex items-center gap-2 text-[14px] font-semibold">
            <Monitor className="h-4 w-4 text-muted-foreground" /> Your website&rsquo;s design
          </span>
          <span className="block text-[12px] text-muted-foreground">
            {following
              ? "Mox makes your pictures in this design: its world, art, type and layout."
              : "Screenshots of your site. Mox learns your design from them."}
          </span>
        </div>
        {following && (
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-primary/12 px-3 text-[11.5px] font-semibold ring-1 ring-primary/25">
            <Check className="h-3.5 w-3.5" /> Custom look on
          </span>
        )}
      </div>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
        {cards.map((card, i) => (
          <motion.figure
            key={card.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: Math.min(i, 8) * 0.04, ease: EASE }}
            className={cn(
              "group relative shrink-0 overflow-hidden rounded-[18px] bg-[var(--ds-well-bg)] ring-1 ring-[var(--ds-tile-border)]",
              card.capture ? "h-56 w-40" : "h-56 w-72",
            )}
          >
            {card.thumbUrl && (
              <a
                href={card.url ?? card.thumbUrl}
                target="_blank"
                rel="noreferrer"
                className={dsFocus}
              >
                <img
                  src={card.thumbUrl}
                  alt={card.label}
                  loading="lazy"
                  decoding="async"
                  className={cn(
                    "size-full transition-[object-position] duration-[2400ms] ease-[cubic-bezier(0.16,1,0.3,1)]",
                    card.capture
                      ? "object-cover object-top group-hover:object-bottom"
                      : "object-cover object-top",
                  )}
                />
              </a>
            )}
            <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2.5 pb-2 pt-6 text-[11px] font-semibold text-white">
              <span className="block truncate">
                {card.capture ? "Whole page" : card.label.split(" · ").pop()}
              </span>
            </figcaption>
            {canEdit && !card.capture && (
              <button
                type="button"
                aria-label="Don't use this screenshot"
                onClick={() => onRemove(card)}
                className={cn(
                  "absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-black/45 text-[13px] font-semibold text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100",
                  dsFocus,
                )}
              >
                ×
              </button>
            )}
          </motion.figure>
        ))}
      </div>
    </div>
  );
}

function Price({ credits }: { credits: number }) {
  return (
    <span data-slot="cost-chip" className="rounded-full px-2 py-0.5 text-[11px] font-semibold">
      {credits ? `${credits} credits` : "Included"}
    </span>
  );
}

export function Board({
  view,
  steps,
  strength,
  handlers,
}: {
  view: InspoView;
  steps: StrengthStep[];
  strength: { score: number; level: string };
  handlers: InspoHandlers;
}) {
  const [filter, setFilter] = React.useState<Filter>("all");
  const [addAs, setAddAs] = React.useState<InspoChip>("like");
  const taste = view.taste;
  const canEdit = !!taste?.canEdit;
  const site = siteDesignCards(view.cards);
  const board = shelfCards(view.cards, "board").filter((c) => !c.siteShot);
  const shown = filter === "all" ? board : board.filter((c) => c.chip === filter);
  const uploads = view.uploads.filter((u) => u.chip === "like" || u.chip === "avoid");
  const thumbs = board.filter((c) => c.kind === "image" && c.thumbUrl).map((c) => c.thumbUrl!);
  const next = steps.filter((s) => !s.done).slice(0, 3);
  const learning = !!taste?.running || view.busy === "learn" || view.busy === "scan";

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-2.5">
          <InspoDrop
            title={addAs === "avoid" ? "Drop looks to avoid" : "Drop posts you love"}
            thumbs={thumbs.slice(0, 3)}
            disabled={!canEdit}
            onFiles={(files) => handlers.upload(files, addAs)}
            onLink={(url) => handlers.addLink(url, addAs)}
          />
          <div className="flex flex-wrap items-center gap-2 px-1 text-[12px] text-muted-foreground">
            Add as
            <LayoutGroup id="inspo-add-as">
              <div className="ds-well inline-flex p-0.5">
                {BOARD_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    aria-pressed={addAs === chip}
                    onClick={() => setAddAs(chip)}
                    className={cn(
                      "relative h-7 rounded-full px-3 text-[12px] font-semibold transition-colors",
                      addAs === chip
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                      dsFocus,
                    )}
                  >
                    {addAs === chip && (
                      <motion.span
                        layoutId="inspo-add-as-pill"
                        className="absolute inset-0 rounded-full bg-[var(--ds-tile-bg)] shadow-sm ring-1 ring-primary/30"
                        transition={{ type: "spring", stiffness: 420, damping: 34 }}
                      />
                    )}
                    <span className="relative">{chip === "like" ? "Love it" : "Avoid"}</span>
                  </button>
                ))}
              </div>
            </LayoutGroup>
          </div>
        </div>

        <div className="flex flex-col justify-between gap-4 rounded-[28px] bg-[var(--ds-tile-bg)] p-5 ring-1 ring-[var(--ds-tile-border)]">
          {/* The rail shows the ring on wide screens; here it leads on phones. */}
          <div className="lg:hidden">
            <StrengthRing score={strength.score} level={strength.level} />
          </div>
          <span className="hidden text-[13.5px] font-semibold lg:block">Next up</span>
          <ul className="space-y-1.5">
            {next.length ? (
              next.map((s, i) => (
                <motion.li
                  key={s.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.15 + i * 0.06, duration: 0.35, ease: EASE }}
                >
                  <button
                    type="button"
                    onClick={() => handlers.onSection(s.section as InspoSection)}
                    className={cn(
                      "group flex w-full items-center gap-2 rounded-full bg-[var(--ds-well-bg)] px-3 py-1.5 text-left text-[12.5px] font-medium transition-colors hover:bg-[var(--ds-well-bg-hover)]",
                      dsFocus,
                    )}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    <span className="min-w-0 flex-1 truncate">{s.label}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </button>
                </motion.li>
              ))
            ) : (
              <li className="flex items-center gap-2 text-[12.5px] font-medium text-primary-ink">
                <Check className="h-4 w-4" /> All set
              </li>
            )}
          </ul>
        </div>
      </div>

      {/* Learning the style starts by itself after Love/Avoid uploads; the
          buttons stay for a re-learn by hand. */}
      {taste?.available !== false && (
        <div className="flex flex-wrap items-center gap-2">
          {learning ? (
            <motion.span
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-primary/12 px-4 text-[13px] font-semibold ring-1 ring-primary/25"
              role="status"
            >
              <Spinner className="h-4 w-4 animate-spin text-primary-ink" />
              {taste?.running?.stage === "capturing"
                ? "Reading your site…"
                : "Learning your style…"}
            </motion.span>
          ) : (
            <>
              <button
                type="button"
                className={cn(taste?.active ? dsGhostBtn : dsPrimaryBtn, "h-10 px-4 text-[13px]")}
                disabled={!canEdit || !canLearn(view.cards) || !!view.busy}
                onClick={handlers.learn}
                data-testid="inspo-learn"
                title="Mox learns by itself after you add pictures. Press this to learn again now."
              >
                <Sparkles className="h-4 w-4" />{" "}
                {taste?.active ? "Update from board" : "Learn my style"}{" "}
                <Price credits={taste?.learnPrice ?? 0} />
              </button>
              {view.dna.websiteUrl && (
                <button
                  type="button"
                  className={cn(dsGhostBtn, "h-10 px-4 text-[13px]")}
                  disabled={!canEdit || !!view.busy}
                  onClick={handlers.learnFromSite}
                >
                  <Globe className="h-4 w-4" /> From my site{" "}
                  <Price credits={taste?.learnPrice ?? 0} />
                </button>
              )}
            </>
          )}
          {taste?.active && !taste.draft && (
            <AdherencePill
              value={taste.adherence}
              disabled={!canEdit || !!view.busy}
              onChange={handlers.setAdherence}
            />
          )}
          {taste?.active && !taste.draft && (
            <span className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--ds-well-bg)] pl-3 pr-1 text-[12.5px] font-medium">
              <span className="h-2 w-2 rounded-full bg-primary shadow-[0_0_0_4px_hsl(var(--primary)/0.2)]" />
              {taste.active.name}
              <button
                type="button"
                className={cn(dsGhostBtn, "h-8 px-3 text-[12px]")}
                disabled={!canEdit || !!view.busy}
                onClick={handlers.stopDirection}
              >
                Stop
              </button>
            </span>
          )}
          {!learning && taste?.lastError && (
            <span className="text-[12px] text-muted-foreground">{taste.lastError}</span>
          )}
        </div>
      )}

      <SiteDesignStrip
        cards={site}
        following={
          !!taste?.active &&
          (view.look.visual?.stylesAuto === true ||
            !view.look.visual?.styles?.length ||
            view.look.visual.styles[0] === "custom")
        }
        canEdit={canEdit}
        onRemove={handlers.remove}
      />

      <AnimatePresence>
        {taste?.draft && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4, ease: EASE }}
            className="rounded-[28px] bg-[var(--ds-tile-bg)] p-4 ring-1 ring-primary/30 sm:p-5"
            data-testid="inspo-directions"
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="block text-[14px] font-semibold">
                  {taste.auto ? "In use — Mellox picked this from your site" : "Pick your style"}
                </span>
                {taste.auto && (
                  <span className="block text-[12px] text-muted-foreground">
                    Your posts already follow it. Keep it, pick another, or stop.
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <AdherencePill
                  value={taste.adherence}
                  disabled={!canEdit || !!view.busy}
                  onChange={handlers.setAdherence}
                />
                {taste.auto && (
                  <button
                    type="button"
                    className={cn(dsGhostBtn, "h-9 px-4 text-[13px]")}
                    disabled={!canEdit || !!view.busy}
                    onClick={handlers.stopDirection}
                  >
                    Stop
                  </button>
                )}
                <button
                  type="button"
                  className={cn(dsPrimaryBtn, "h-9 px-4 text-[13px]")}
                  disabled={!canEdit || !!view.busy}
                  onClick={handlers.useDirection}
                  data-testid="inspo-use-direction"
                >
                  {view.busy === "direction" ? (
                    <Spinner className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  {taste.auto ? "Keep this" : "Use this"}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {taste.draft.profile.directions.map((d, i) => {
                const on = taste.draft!.profile.selected === i;
                return (
                  <motion.button
                    key={i}
                    type="button"
                    aria-pressed={on}
                    onClick={() => handlers.pickDirection(i)}
                    whileHover={{ y: -3 }}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0, scale: on ? 1 : 0.985 }}
                    transition={{ duration: 0.35, delay: i * 0.06, ease: EASE }}
                    className={cn(
                      "min-w-0 rounded-[22px] bg-[var(--ds-well-bg)] p-2.5 text-left ring-1 transition-shadow",
                      on ? "ring-2 ring-primary" : "ring-transparent hover:ring-primary/30",
                      dsFocus,
                    )}
                  >
                    <DirectionArt
                      dna={view.dna}
                      profile={taste.draft!.profile}
                      index={i}
                      sources={taste.sources}
                    />
                    <div className="mt-2.5 flex items-center justify-between gap-2 px-1 text-[13px] font-semibold">
                      <span className="truncate">{d.name}</span>
                      {on && <Check className="h-4 w-4 shrink-0 text-primary-ink" />}
                    </div>
                    <BibleNotes profile={taste.draft!.profile} index={i} />
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {(board.length > 0 || uploads.length > 0) && (
        <>
          <LayoutGroup id="inspo-filter">
            <div className="flex gap-1.5" role="tablist" aria-label="Show">
              {(["all", "like", "avoid"] as const).map((f) => {
                const count = f === "all" ? board.length : board.filter((c) => c.chip === f).length;
                const on = filter === f;
                return (
                  <button
                    key={f}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setFilter(f)}
                    className={cn(
                      "relative h-8 rounded-full px-3.5 text-[12.5px] font-semibold transition-colors",
                      on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                      dsFocus,
                    )}
                  >
                    {on && (
                      <motion.span
                        layoutId="inspo-filter-pill"
                        className="absolute inset-0 rounded-full bg-primary/12 ring-1 ring-primary/20"
                        transition={{ type: "spring", stiffness: 420, damping: 34 }}
                      />
                    )}
                    <span className="relative">
                      {f === "all" ? "All" : f === "like" ? "Love" : "Avoid"}{" "}
                      <span className="tabular-nums text-muted-foreground">{count}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </LayoutGroup>
          <CardWall testId="inspo-board">
            {uploads.map((u) => (
              <UploadCardView key={u.id} upload={u} />
            ))}
            {shown.map((card) => (
              <InspoCardView
                key={card.id}
                card={card}
                chips={BOARD_CHIPS}
                canEdit={canEdit}
                onChip={(chip) => handlers.setChip(card, chip)}
                onRemove={() => handlers.remove(card)}
                onUse={card.kind === "image" ? () => handlers.useInPost(card) : undefined}
              />
            ))}
          </CardWall>
        </>
      )}
    </div>
  );
}
