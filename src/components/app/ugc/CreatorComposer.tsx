"use client";

// Creator video ads, Holo-style: one screen. Pick a creator on the left; the
// product (from the Brand DNA catalogue), what they say, the feeling and the
// platform on the right; Generate floats bottom right. Presentational: the
// data and every action come from UgcStudio (or /layout-lab).

import { useMemo, useState } from "react";
import {
  Check,
  ImagePlus,
  Plus,
  ShoppingBag,
  Search,
  Sparkles,
  Star,
  User,
  Video,
} from "@/components/icons";
import { PlatformAppIcon } from "@/components/brand/PlatformAppIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  customCreatorProblem,
  filterCreators,
  type BrandCreatorRef,
  type CreatorFilter,
  type StockCreator,
} from "@/lib/ugc/creators";
import {
  CREATOR_VIBES,
  PLATFORMS,
  SETTINGS,
  TONES,
  labelOf,
  type PlatformId,
  type SettingId,
  type ToneId,
} from "@/lib/ugc/options";
import { dialogueWordBudget } from "@/lib/ugc/prompt";
import type { Product, ReferenceImageView } from "@/lib/ugc/schemas";
import { typedWordCount } from "@/lib/ugc/script-text";
import { cn } from "@/lib/utils";
import { CreatorFace } from "./CreatorPortrait";

export type CreatorChoice = { kind: "stock"; id: string } | { kind: "person"; assetId: string };

export type CreatorDraft = {
  creator: CreatorChoice | null;
  productKey: string | null;
  scriptText: string;
  tone: ToneId;
  setting: SettingId;
  platform: PlatformId;
  durationSec: number;
};

export type BrandPerson = {
  assetId: string;
  url: string | null;
  name: string;
  /** Found on the brand's own website (Inspo's site read): suggested first. */
  fromSite?: boolean;
};

export type NewCreator = {
  name: string;
  look: string;
  gender: "woman" | "man" | "person";
  age: string;
  setting: string;
};

export type ComposerProduct = {
  key: string;
  name: string;
  imageUrl: string | null;
  product: Product;
  references: ReferenceImageView[];
};

export type ComposerIdea = { id: string; title: string };

const PLATFORM_ICON: Record<PlatformId, "tiktok" | "instagram" | "youtube" | "facebook"> = {
  tiktok: "tiktok",
  reels: "instagram",
  shorts: "youtube",
  facebook: "facebook",
};

type Filter = CreatorFilter | "people";

export function sameChoice(a: CreatorChoice | null, b: BrandCreatorRef | null): boolean {
  if (!a || !b) return false;
  return a.kind === "stock" ? a.id === b.id : a.assetId === b.personAssetId;
}

export function CreatorComposer({
  draft,
  onDraft,
  creators,
  suggested,
  people,
  brandCreator,
  products,
  durations,
  ideas,
  conceptPrice,
  videosLeft,
  busy,
  onWrite,
  onPickIdea,
  onGenerate,
  onToggleBrandCreator,
  onAddProducts,
  onAddPeople,
  creatorPrice,
  onCreateCreator,
}: {
  draft: CreatorDraft;
  onDraft: (patch: Partial<CreatorDraft>) => void;
  creators: readonly StockCreator[];
  suggested: readonly string[];
  people: readonly BrandPerson[];
  brandCreator: BrandCreatorRef | null;
  /** null while loading. */
  products: readonly ComposerProduct[] | null;
  durations: readonly number[];
  ideas: readonly ComposerIdea[];
  conceptPrice: number;
  videosLeft: number | null;
  busy: null | "write" | "generate";
  onWrite: () => void;
  onPickIdea: (id: string) => void;
  onGenerate: () => void;
  onToggleBrandCreator: () => void;
  onAddProducts: () => void;
  onAddPeople: () => void;
  /** Credits for one "Create your own creator" photo. */
  creatorPrice: number;
  /** Makes the photo; resolves true once the new person is picked. */
  onCreateCreator: (input: NewCreator) => Promise<boolean>;
}) {
  const forBrand = suggested.length > 0 || people.length > 0;
  const [filter, setFilter] = useState<Filter>(forBrand ? "suggested" : "all");
  const [query, setQuery] = useState("");
  const [making, setMaking] = useState(false);

  const shown = useMemo(
    () => (filter === "people" ? [] : filterCreators(creators, filter, query, suggested)),
    [creators, filter, query, suggested],
  );
  const shownPeople = useMemo(() => {
    if (filter === "woman" || filter === "man") return [];
    const q = query.trim().toLowerCase();
    // The brand's own people lead, the ones found on its website first.
    return people
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => Number(!!b.fromSite) - Number(!!a.fromSite));
  }, [people, filter, query]);

  const choice = draft.creator;
  const chosenStock =
    choice?.kind === "stock" ? creators.find((c) => c.id === choice.id) : undefined;
  const chosenPerson =
    choice?.kind === "person" ? people.find((p) => p.assetId === choice.assetId) : undefined;
  const isBrandCreator = sameChoice(draft.creator, brandCreator);
  const product = products?.find((p) => p.key === draft.productKey) ?? null;

  const words = typedWordCount(draft.scriptText);
  const budget = dialogueWordBudget(draft.durationSec);
  const missing = !draft.creator
    ? "Pick a creator"
    : !product
      ? "Pick a product"
      : !draft.scriptText.trim()
        ? "Write what they say"
        : null;

  const filters: { id: Filter; label: string }[] = [
    ...(forBrand ? [{ id: "suggested" as const, label: "For your brand" }] : []),
    { id: "all", label: "All" },
    { id: "woman", label: "Women" },
    { id: "man", label: "Men" },
    { id: "people", label: `Your people${people.length ? ` · ${people.length}` : ""}` },
  ];

  return (
    <div className="relative pb-24">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ── Left: choose the creator ─────────────────────────────── */}
        <section aria-labelledby="creator-heading" className="min-w-0 space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 id="creator-heading" className="text-base font-semibold tracking-tight">
              Choose creator
            </h3>
            <span className="text-xs text-muted-foreground tabular-nums">
              {creators.length + people.length} available
            </span>
          </div>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search creators: skincare, gym, founder…"
              aria-label="Search creators"
              className="h-10 rounded-full pl-10"
            />
          </div>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Creator filter">
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  "h-8 rounded-full px-3.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                  filter === f.id
                    ? "bg-foreground text-background"
                    : "bg-[var(--ds-well-bg)] text-muted-foreground hover:text-foreground",
                )}
              >
                {f.id === "suggested" ? (
                  <Sparkles className="mr-1 inline size-3" aria-hidden />
                ) : null}
                {f.label}
              </button>
            ))}
          </div>

          <div className="rounded-[22px] border border-[var(--ds-tile-border)] bg-background/70 p-2.5">
            {making ? (
              <CreatorMaker
                price={creatorPrice}
                onCancel={() => setMaking(false)}
                onCreate={async (input) => {
                  const ok = await onCreateCreator(input);
                  if (ok) {
                    setMaking(false);
                    setFilter("suggested");
                  }
                  return ok;
                }}
              />
            ) : (
              <ul
                className="grid max-h-[min(62vh,640px)] grid-cols-2 gap-2.5 overflow-y-auto overscroll-contain p-0.5 sm:grid-cols-3"
                aria-label="Creators"
              >
                <li>
                  <button
                    type="button"
                    onClick={() => setMaking(true)}
                    className="flex aspect-[4/5] w-full flex-col items-center justify-center gap-2 rounded-[18px] border-2 border-dashed border-[var(--ds-tile-border)] p-3 text-center text-muted-foreground transition-colors hover:border-primary/60 hover:bg-primary/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    <span className="grid size-11 place-items-center rounded-full bg-primary/15 text-primary-ink">
                      <Sparkles className="size-5" aria-hidden />
                    </span>
                    <span className="text-[13px] font-semibold text-foreground">
                      Create your own
                    </span>
                    <span className="text-[11px]">Describe them, Mox makes them</span>
                  </button>
                </li>
                {filter === "people" ? (
                  <li>
                    <button
                      type="button"
                      onClick={onAddPeople}
                      className="flex aspect-[4/5] w-full flex-col items-center justify-center gap-2 rounded-[18px] border-2 border-dashed border-[var(--ds-tile-border)] p-3 text-center text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <ImagePlus className="size-5" aria-hidden />
                      <span className="text-[13px] font-semibold text-foreground">
                        Add photos of your people
                      </span>
                      <span className="text-[11px]">Your team or ambassadors, in Inspo</span>
                    </button>
                  </li>
                ) : null}
                {shownPeople.map((p) => (
                  <li key={p.assetId}>
                    <CreatorCard
                      name={p.name}
                      meta={p.fromSite ? "From your website" : "Your people"}
                      selected={
                        draft.creator?.kind === "person" && draft.creator.assetId === p.assetId
                      }
                      brand={brandCreator?.personAssetId === p.assetId}
                      onSelect={() => onDraft({ creator: { kind: "person", assetId: p.assetId } })}
                    >
                      {p.url ? (
                        <img
                          src={p.url}
                          alt=""
                          className="size-full! object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <User className="size-8 text-muted-foreground" aria-hidden />
                      )}
                    </CreatorCard>
                  </li>
                ))}
                {shown.map((c) => (
                  <li key={c.id}>
                    <CreatorCard
                      name={c.name}
                      meta={`${c.age.replace("-", "–")} · ${labelOf(CREATOR_VIBES, c.vibe)}`}
                      selected={draft.creator?.kind === "stock" && draft.creator.id === c.id}
                      brand={brandCreator?.id === c.id}
                      suggested={filter !== "suggested" && suggested.includes(c.id)}
                      onSelect={() => onDraft({ creator: { kind: "stock", id: c.id } })}
                    >
                      <CreatorFace creator={c} />
                    </CreatorCard>
                  </li>
                ))}
                {query.trim() && !shown.length && !shownPeople.length ? (
                  <li className="col-span-full py-12 text-center text-sm text-muted-foreground">
                    No creator matches “{query}”.
                  </li>
                ) : null}
              </ul>
            )}
          </div>
        </section>

        {/* ── Right: product, script and feel ──────────────────────── */}
        <aside className="min-w-0 space-y-5" aria-label="Video details">
          <div className="space-y-2">
            <h3 className="text-base font-semibold tracking-tight">Product</h3>
            {products === null ? (
              <div className="flex gap-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-[92px] w-[84px] rounded-2xl" />
                ))}
              </div>
            ) : products.length ? (
              <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="Your products">
                {products.map((p) => {
                  const on = p.key === draft.productKey;
                  return (
                    <li key={p.key} className="shrink-0">
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => onDraft({ productKey: p.key })}
                        className={cn(
                          "flex w-[84px] flex-col items-center gap-1.5 rounded-2xl p-1.5 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                          on
                            ? "bg-primary/10 ring-2 ring-primary"
                            : "ring-1 ring-[var(--ds-tile-border)] hover:bg-[var(--ds-well-bg)]",
                        )}
                      >
                        <span className="grid size-[60px] place-items-center overflow-hidden rounded-xl bg-[var(--ds-well-bg)]">
                          {p.imageUrl ? (
                            <img
                              src={p.imageUrl}
                              alt=""
                              className="size-full! object-contain"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <ShoppingBag className="size-5 text-muted-foreground" aria-hidden />
                          )}
                        </span>
                        <span className="line-clamp-2 text-[11px] font-medium leading-tight">
                          {p.name}
                        </span>
                      </button>
                    </li>
                  );
                })}
                <li className="shrink-0">
                  <button
                    type="button"
                    onClick={onAddProducts}
                    className="flex h-full min-h-[92px] w-[84px] flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-[var(--ds-tile-border)] text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <Plus className="size-4" aria-hidden /> Add
                  </button>
                </li>
              </ul>
            ) : (
              <div className="flex items-center gap-3 rounded-2xl bg-[var(--ds-well-bg)] p-3.5">
                <ShoppingBag className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                  Your products appear here from Brand DNA. Add the one to show.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={onAddProducts}
                >
                  Add product
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="creator-script" className="text-base font-semibold tracking-tight">
                Script
              </label>
              <span
                className={cn(
                  "rounded-full bg-[var(--ds-well-bg)] px-2.5 py-0.5 text-[11px] tabular-nums",
                  words > budget ? "text-warning" : "text-muted-foreground",
                )}
                title={`About ${budget} words fit in ${draft.durationSec} seconds`}
              >
                {words} / {budget} words
              </span>
            </div>
            <div className="rounded-[20px] border border-[var(--ds-tile-border)] bg-background focus-within:ring-2 focus-within:ring-ring/40">
              <Textarea
                id="creator-script"
                value={draft.scriptText}
                onChange={(e) => onDraft({ scriptText: e.target.value })}
                placeholder="Write what the creator says. Keep it natural and conversational, like talking to a friend…"
                className="min-h-[150px] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
                maxLength={2000}
              />
              <div className="flex flex-wrap items-center gap-1.5 px-3 pb-3">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  disabled={!product || busy !== null}
                  loading={busy === "write"}
                  onClick={onWrite}
                  title={product ? undefined : "Pick a product first"}
                >
                  {busy === "write" ? null : <Sparkles aria-hidden />}
                  {draft.scriptText.trim() ? "Write new ideas" : "Write it for me"}
                  <span className="text-muted-foreground tabular-nums">· {conceptPrice} cr</span>
                </Button>
                {ideas.map((idea) => (
                  <button
                    key={idea.id}
                    type="button"
                    onClick={() => onPickIdea(idea.id)}
                    className="h-8 max-w-[200px] truncate rounded-full bg-[var(--ds-well-bg)] px-3 text-xs text-muted-foreground hover:text-foreground"
                    title={idea.title}
                  >
                    {idea.title}
                  </button>
                ))}
              </div>
            </div>
            {words > budget ? (
              <p className="text-xs text-warning">
                That's more than fits in {draft.durationSec}s. Trim it or pick a longer video.
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Picker
              label="Emotion"
              value={draft.tone}
              options={TONES}
              onChange={(tone) => onDraft({ tone: tone as ToneId })}
            />
            <Picker
              label="Place"
              value={draft.setting}
              options={SETTINGS}
              onChange={(setting) => onDraft({ setting: setting as SettingId })}
            />
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium">Where it goes</span>
            <div className="flex flex-wrap items-center gap-2">
              {PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={draft.platform === p.id}
                  aria-label={p.label}
                  title={p.label}
                  onClick={() => onDraft({ platform: p.id })}
                  className={cn(
                    "grid size-10 place-items-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                    draft.platform === p.id
                      ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                      : "opacity-60 hover:opacity-100",
                  )}
                >
                  <PlatformAppIcon platform={PLATFORM_ICON[p.id]} size={32} />
                </button>
              ))}
              <span className="mx-1 h-6 w-px bg-[var(--ds-tile-border)]" aria-hidden />
              <div className="flex gap-1" role="radiogroup" aria-label="Length">
                {durations.map((d) => (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={draft.durationSec === d}
                    onClick={() => onDraft({ durationSec: d })}
                    className={cn(
                      "h-8 min-w-11 rounded-full px-2.5 text-xs font-medium tabular-nums transition",
                      draft.durationSec === d
                        ? "bg-foreground text-background"
                        : "bg-[var(--ds-well-bg)] text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* The chosen creator, like Holo's "Select an Influencer" card. */}
          <div className="rounded-[20px] bg-[var(--ds-well-bg)] p-3.5">
            {chosenStock || chosenPerson ? (
              <div className="flex items-center gap-3">
                <span className="size-14 shrink-0 overflow-hidden rounded-2xl bg-background">
                  {chosenStock ? (
                    <CreatorFace creator={chosenStock} />
                  ) : chosenPerson?.url ? (
                    <img
                      src={chosenPerson.url}
                      alt=""
                      className="size-full! object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : null}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {chosenStock?.name ?? chosenPerson?.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {chosenStock?.tagline ?? "One of your people"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={isBrandCreator ? "secondary" : "outline"}
                  className="shrink-0 rounded-full"
                  aria-pressed={isBrandCreator}
                  onClick={onToggleBrandCreator}
                  title="Use this creator for every video ad, so your brand has one face"
                >
                  <Star className={cn(isBrandCreator && "fill-current")} aria-hidden />
                  {isBrandCreator ? "Brand face" : "Use always"}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-background">
                  <User className="size-4 text-muted-foreground" aria-hidden />
                </span>
                <div>
                  <p className="text-sm font-semibold">Pick a creator</p>
                  <p className="text-xs text-muted-foreground">
                    {suggested.length
                      ? "The ones under “For your brand” match your audience."
                      : "Pick the person who will talk about your product."}
                  </p>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Generate floats bottom right. */}
      <div className="pointer-events-none sticky bottom-3 z-10 mt-6 flex justify-end">
        <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-background/85 py-1.5 pl-4 pr-1.5 shadow-[0_10px_30px_-18px_rgb(0_0_0/0.5)] ring-1 ring-[var(--ds-tile-border)] backdrop-blur">
          <span className="text-xs text-muted-foreground tabular-nums">
            {missing ??
              (videosLeft === null
                ? `${draft.durationSec}s video`
                : `${videosLeft} video${videosLeft === 1 ? "" : "s"} left`)}
          </span>
          <Button
            size="lg"
            className="studio-cta relative"
            disabled={!!missing || busy !== null}
            loading={busy === "generate"}
            onClick={onGenerate}
          >
            {busy === "generate" ? null : <Video aria-hidden />}
            Generate video
          </Button>
        </div>
      </div>
    </div>
  );
}

function CreatorCard({
  name,
  meta,
  selected,
  brand,
  suggested,
  onSelect,
  children,
}: {
  name: string;
  meta: string;
  selected: boolean;
  brand?: boolean;
  suggested?: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${name}, ${meta}`}
      onClick={onSelect}
      className={cn(
        "group relative block aspect-[4/5] w-full overflow-hidden rounded-[18px] bg-[var(--ds-well-bg)] text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        selected ? "ring-[3px] ring-primary" : "hover:-translate-y-0.5",
      )}
    >
      <span className="absolute inset-0 grid place-items-center">{children}</span>
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent px-2.5 pb-2 pt-8 text-white">
        <span className="block truncate text-[13px] font-semibold">{name}</span>
        <span className="block truncate text-[10.5px] text-white/75">{meta}</span>
      </span>
      {brand ? (
        <span className="absolute left-2 top-2 inline-flex h-6 items-center gap-1 rounded-full bg-black/55 px-2 text-[10.5px] font-medium text-white backdrop-blur">
          <Star className="size-3 fill-current" aria-hidden /> Brand face
        </span>
      ) : suggested ? (
        <span className="absolute left-2 top-2 grid size-6 place-items-center rounded-full bg-black/45 text-white backdrop-blur">
          <Sparkles className="size-3" aria-hidden />
          <span className="sr-only">Suggested for your brand</span>
        </span>
      ) : null}
      {selected ? (
        <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-3.5" aria-hidden />
        </span>
      ) : null}
    </button>
  );
}

function Picker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { id: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label} className="h-10 w-full rounded-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const AGE_CHIPS = [
  { id: "18-24", label: "18–24" },
  { id: "25-34", label: "25–34" },
  { id: "35-44", label: "35–44" },
  { id: "45-60", label: "45–60" },
] as const;

/** "Create your own creator": a few words become one photo of an original person. */
function CreatorMaker({
  price,
  onCancel,
  onCreate,
}: {
  price: number;
  onCancel: () => void;
  onCreate: (input: NewCreator) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [look, setLook] = useState("");
  const [gender, setGender] = useState<NewCreator["gender"]>("woman");
  const [age, setAge] = useState("25-34");
  const [setting, setSetting] = useState<SettingId>("home");
  const [busy, setBusy] = useState(false);
  const problem = customCreatorProblem(name, look);

  const chip = (on: boolean) =>
    cn(
      "h-8 rounded-full px-3 text-xs font-medium transition-colors",
      on
        ? "bg-foreground text-background"
        : "bg-[var(--ds-well-bg)] text-muted-foreground hover:text-foreground",
    );

  return (
    <form
      className="space-y-4 p-3 sm:p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (problem || busy) return;
        setBusy(true);
        try {
          await onCreate({ name: name.trim(), look: look.trim(), gender, age, setting });
        } finally {
          setBusy(false);
        }
      }}
    >
      <div>
        <h4 className="text-sm font-semibold">Create your own creator</h4>
        <p className="text-xs text-muted-foreground">
          An original person made for your brand, photographed like a real Reel. Make them your
          brand face so every video has the same person.
        </p>
      </div>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium">Name</span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="e.g. Sara"
          className="h-10 rounded-full"
        />
      </label>
      <div className="flex flex-wrap gap-1.5">
        {(["woman", "man", "person"] as const).map((g) => (
          <button
            key={g}
            type="button"
            aria-pressed={gender === g}
            onClick={() => setGender(g)}
            className={chip(gender === g)}
          >
            {g === "woman" ? "Woman" : g === "man" ? "Man" : "Any"}
          </button>
        ))}
        <span className="mx-1 h-6 w-px self-center bg-[var(--ds-tile-border)]" aria-hidden />
        {AGE_CHIPS.map((a) => (
          <button
            key={a.id}
            type="button"
            aria-pressed={age === a.id}
            onClick={() => setAge(a.id)}
            className={chip(age === a.id)}
          >
            {a.label}
          </button>
        ))}
      </div>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium">How they look</span>
        <Textarea
          value={look}
          onChange={(e) => setLook(e.target.value)}
          maxLength={400}
          placeholder="Curly dark hair, warm smile, freckles, oversized denim jacket, gold hoops…"
          className="min-h-[90px] resize-none rounded-[18px]"
        />
      </label>
      <Picker
        label="Where they film"
        value={setting}
        options={SETTINGS.filter((x) => x.id !== "auto")}
        onChange={(v) => setSetting(v as SettingId)}
      />
      {look.trim().length >= 12 && problem ? (
        <p className="text-xs text-warning">{problem}</p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" className="rounded-full" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="studio-cta relative" disabled={!!problem} loading={busy}>
          {busy ? null : <Sparkles aria-hidden />}
          Create creator
          <span className="tabular-nums opacity-70">· {price} cr</span>
        </Button>
      </div>
    </form>
  );
}
