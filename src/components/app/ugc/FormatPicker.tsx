"use client";

// The first step of a Creator video: what kind of Reel it is. A grid of 9:16
// picture cards grouped like Instagram's own formats (interviews, skits,
// talking, reviews, lifestyle), with Auto first. Presentational: the formats
// are data (src/lib/ugc/formats/), the pick goes back through `onPick`.

import { useMemo, useState } from "react";
import { Check, Search, Sparkles } from "@/components/icons";
import { Input } from "@/components/ui/input";
import { formatThumbPath } from "@/lib/ugc/format-thumbs";
import { UGC_FORMAT_GROUPS, UGC_FORMATS } from "@/lib/ugc/formats/formats";
import type { UgcFormat, UgcFormatGroup } from "@/lib/ugc/formats/types";
import { cn } from "@/lib/utils";
import { HookTextSample } from "./HookTextSample";

/** A soft wash per group, so a card without its picture still reads as its kind. */
const GROUP_WASH: Record<UgcFormatGroup, string> = {
  interview: "from-[#2b3340] via-[#4b5566] to-[#8b93a1]",
  skit: "from-[#3a2f4a] via-[#6a4f7a] to-[#b08fb8]",
  talk: "from-[#2f3d36] via-[#4f6a5c] to-[#9cb5a6]",
  review: "from-[#40342a] via-[#7a6248] to-[#c9ad8a]",
  lifestyle: "from-[#3d2f33] via-[#7a5560] to-[#d3a7b1]",
};

type GroupFilter = "all" | "suggested" | UgcFormatGroup;

export function FormatPicker({
  value,
  suggested,
  onPick,
}: {
  /** "auto", a format id, or null when nothing is picked yet. */
  value: string | null;
  /** Format ids that suit this brand, best first. */
  suggested: readonly string[];
  onPick: (id: string) => void;
}) {
  const [group, setGroup] = useState<GroupFilter>(suggested.length ? "suggested" : "all");
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list =
      group === "suggested"
        ? suggested.map((id) => UGC_FORMATS.find((f) => f.id === id)).filter(Boolean)
        : group === "all"
          ? UGC_FORMATS
          : UGC_FORMATS.filter((f) => f.group === group);
    return (list as UgcFormat[]).filter(
      (f) =>
        !q ||
        f.label.toLowerCase().includes(q) ||
        f.hint.toLowerCase().includes(q) ||
        f.tags.some((t) => t.includes(q)),
    );
  }, [group, query, suggested]);

  const tabs: { id: GroupFilter; label: string }[] = [
    ...(suggested.length ? [{ id: "suggested" as const, label: "For your brand" }] : []),
    { id: "all", label: "All" },
    ...UGC_FORMAT_GROUPS.map((g) => ({ id: g.id, label: g.label })),
  ];

  return (
    <section aria-labelledby="format-heading" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="format-heading" className="text-base font-semibold tracking-tight">
            Choose a format
          </h3>
          <p className="text-xs text-muted-foreground">
            The kind of Reel it is. Each one is filmed, cut and captioned like the real thing.
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search: interview, skit, review…"
            aria-label="Search formats"
            className="h-10 rounded-full pl-10"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Format group">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={group === t.id}
            onClick={() => setGroup(t.id)}
            className={cn(
              "h-8 rounded-full px-3.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
              group === t.id
                ? "bg-foreground text-background"
                : "bg-[var(--ds-well-bg)] text-muted-foreground hover:text-foreground",
            )}
          >
            {t.id === "suggested" ? <Sparkles className="mr-1 inline size-3" aria-hidden /> : null}
            {t.label}
          </button>
        ))}
      </div>

      <ul
        className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6"
        aria-label="Formats"
      >
        {!query.trim() ? (
          <li>
            <button
              type="button"
              aria-pressed={value === "auto"}
              onClick={() => onPick("auto")}
              className={cn(
                "relative flex aspect-[9/16] w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-[18px] p-3 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                "bg-[var(--ds-well-bg)]",
                value === "auto" ? "ring-[3px] ring-primary" : "hover:-translate-y-0.5",
              )}
            >
              <span className="grid size-12 place-items-center rounded-full bg-primary/15 text-primary-ink">
                <Sparkles className="size-5" aria-hidden />
              </span>
              <span className="text-[13px] font-semibold">Auto</span>
              <span className="text-[11px] text-muted-foreground">
                Mox tries three formats that suit your brand
              </span>
              {value === "auto" ? <Selected /> : null}
            </button>
          </li>
        ) : null}
        {shown.map((f) => (
          <li key={f.id}>
            <FormatCard
              format={f}
              selected={value === f.id}
              suggested={group !== "suggested" && suggested.slice(0, 6).includes(f.id)}
              onSelect={() => onPick(f.id)}
            />
          </li>
        ))}
        {!shown.length ? (
          <li className="col-span-full py-12 text-center text-sm text-muted-foreground">
            No format matches “{query}”.
          </li>
        ) : null}
      </ul>
    </section>
  );
}

function Selected() {
  return (
    <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground">
      <Check className="size-3.5" aria-hidden />
    </span>
  );
}

export function FormatCard({
  format,
  selected,
  suggested,
  onSelect,
}: {
  format: UgcFormat;
  selected: boolean;
  suggested?: boolean;
  onSelect: () => void;
}) {
  const thumb = formatThumbPath(format.id);
  const people = format.roles.length;
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${format.label}: ${format.hint}`}
      onClick={onSelect}
      className={cn(
        "group relative block aspect-[9/16] w-full overflow-hidden rounded-[18px] bg-gradient-to-b text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        GROUP_WASH[format.group],
        selected ? "ring-[3px] ring-primary" : "hover:-translate-y-0.5",
      )}
    >
      {thumb ? (
        <img
          src={thumb}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
      {/* The format's own hook text, drawn the way the video will carry it. */}
      <span className="absolute inset-x-2 top-[13%] flex justify-center">
        <HookTextSample preset={format.hookText.preset} text={format.hookText.example} size="sm" />
      </span>
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-2.5 pb-2.5 pt-10 text-white">
        <span className="block truncate text-[13px] font-semibold">{format.label}</span>
        <span className="line-clamp-2 text-[10.5px] leading-snug text-white/80">{format.hint}</span>
      </span>
      <span className="absolute left-2 top-2 flex gap-1">
        {suggested ? (
          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-black/50 px-2 text-[10.5px] font-medium text-white backdrop-blur">
            <Sparkles className="size-3" aria-hidden /> For you
          </span>
        ) : null}
        {people === 2 ? (
          <span className="inline-flex h-6 items-center rounded-full bg-black/50 px-2 text-[10.5px] font-medium text-white backdrop-blur">
            2 people
          </span>
        ) : null}
      </span>
      {selected ? <Selected /> : null}
    </button>
  );
}
