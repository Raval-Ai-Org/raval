"use client";

import { useEffect, useRef, useState } from "react";
import {
  BarChart,
  Bookmark,
  Globe,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Repeat2,
  Send,
  Share,
  ThumbsUp,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import { PLATFORMS, type PlatformId } from "@/lib/social-platforms";
import type { AspectRatio } from "@/lib/studio/aspect";
import type { MediaOutput, SocialVariant } from "@/lib/studio/jobs";
import { BrandAvatar, type PreviewBrand } from "./brand";
import { MediaFrame } from "./MediaFrame";

/** Characters visible before each platform's "see more" fold. */
const FOLD: Record<PlatformId, number> = {
  linkedin: 210,
  instagram: 125,
  facebook: 480,
  twitter: 280,
  threads: 500,
  tiktok: 100,
  youtube: 180,
};

/** How each platform colours hashtags, mentions and links. */
const LINK: Partial<Record<PlatformId, string>> = {
  linkedin: "font-semibold text-[#0A66C2] dark:text-[#71B7FB]",
  facebook: "font-medium text-[#1877F2] dark:text-[#4599FF]",
  twitter: "text-[#1D9BF0]",
  instagram: "text-[#00376B] dark:text-[#E0F1FF]",
  threads: "text-[#0095F6]",
};

type Layout = "conversation" | "visual" | "network";

const LAYOUT: Record<PlatformId, Layout> = {
  twitter: "conversation",
  threads: "conversation",
  instagram: "visual",
  tiktok: "visual",
  youtube: "visual",
  linkedin: "network",
  facebook: "network",
};

export function handleFor(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "") || "yourbrand";
}

function RichText({ text, platform }: { text: string; platform: PlatformId }) {
  const parts = text.split(/(#[\p{L}\p{N}_]+|@[\w.]+|https?:\/\/\S+)/u);
  const cls = LINK[platform] ?? "font-medium text-foreground";
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className={cls}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

/**
 * The post as it will appear in each platform's feed: the platform's own
 * layout, the real fold, the media at its real ratio. Platforms render plain
 * text, so the preview does too. Editing happens in place.
 */
export function SocialPostPreview({
  variant,
  brand,
  media,
  ratio,
  editing,
  onChange,
  onRetryMedia,
  onExpand,
  badge,
}: {
  variant: SocialVariant;
  brand: PreviewBrand;
  media?: MediaOutput | null;
  ratio?: AspectRatio;
  editing?: boolean;
  onChange?: (body: string) => void;
  onRetryMedia?: () => void;
  onExpand?: () => void;
  badge?: React.ReactNode;
}) {
  const platform = variant.platform;
  const spec = PLATFORMS[platform];
  const layout = LAYOUT[platform];
  const [expanded, setExpanded] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fold = FOLD[platform];
  const length = variant.body.length;
  const over = length > spec.maxChars;
  const folded = !expanded && length > fold + 20;
  const visible = folded ? `${variant.body.slice(0, fold).trimEnd()}…` : variant.body;
  const handle = handleFor(brand.name);

  useEffect(() => setExpanded(false), [platform]);
  useEffect(() => {
    const el = textarea.current;
    if (!editing || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  const mediaNode = (rounded: boolean, max = 520) =>
    media || ratio ? (
      <MediaFrame
        media={media}
        ratio={media?.ratio ?? ratio ?? "1:1"}
        alt={variant.title}
        onRetry={onRetryMedia}
        onExpand={onExpand}
        rounded={rounded}
        maxHeight={max}
      />
    ) : null;

  const body = (prefix?: React.ReactNode, textClass = "text-sm") =>
    editing ? (
      <textarea
        ref={textarea}
        value={variant.body}
        onChange={(e) => onChange?.(e.target.value)}
        aria-label={`${spec.label} caption`}
        rows={Math.min(18, Math.max(5, Math.ceil(length / 56) + variant.body.split("\n").length))}
        className="block w-full resize-y rounded-xl bg-primary-surface/50 p-3 text-sm leading-relaxed text-foreground outline-none ring-1 ring-primary-border focus-visible:ring-2 focus-visible:ring-primary"
      />
    ) : (
      <p
        className={cn("whitespace-pre-wrap break-words leading-relaxed text-foreground", textClass)}
      >
        {prefix}
        <RichText text={visible} platform={platform} />
        {folded ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="ml-1 text-muted-foreground hover:text-foreground"
          >
            {platform === "linkedin" ? "…see more" : platform === "facebook" ? "See more" : "more"}
          </button>
        ) : null}
      </p>
    );

  let card: React.ReactNode;

  if (layout === "conversation") {
    card = (
      <article className="flex gap-3 px-4 pb-3 pt-4">
        <BrandAvatar brand={brand} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-[15px] leading-5">
            <span className="truncate font-bold text-foreground">{brand.name}</span>
            <span className="truncate text-muted-foreground">
              {platform === "twitter" ? `@${handle} · now` : "now"}
            </span>
            {badge}
            <MoreHorizontal className="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden />
          </div>
          <div className="mt-1">{body(undefined, "text-[15px]")}</div>
          {mediaNode(true, 440) ? (
            <div className="mt-3 overflow-hidden rounded-2xl ring-1 ring-border">
              {mediaNode(false, 440)}
            </div>
          ) : null}
          <div className="mt-3 flex max-w-[380px] items-center justify-between text-muted-foreground [&_svg]:size-[17px]">
            <MessageCircle />
            <Repeat2 />
            <Heart />
            {platform === "twitter" ? <BarChart /> : <Send />}
            <Share />
          </div>
        </div>
      </article>
    );
  } else if (layout === "visual") {
    card = (
      <article>
        <header className="flex items-center gap-2.5 px-3 py-2.5">
          <span className="rounded-full p-[2px] ring-[1.5px] ring-border-strong">
            <BrandAvatar brand={brand} size={30} />
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[13px] font-semibold text-foreground">{handle}</p>
            <p className="truncate text-[11px] text-muted-foreground">{brand.name}</p>
          </div>
          {badge}
          <MoreHorizontal className="size-4 text-foreground" aria-hidden />
        </header>
        {mediaNode(false)}
        <div className="flex items-center gap-4 px-3 pt-3 text-foreground [&_svg]:size-[22px]">
          <Heart />
          <MessageCircle />
          <Send />
          <Bookmark className="ml-auto" />
        </div>
        <div className="px-3 pb-3.5 pt-2">
          {body(<span className="mr-1.5 font-semibold">{handle}</span>)}
        </div>
      </article>
    );
  } else {
    card = (
      <article>
        <header className="flex items-start gap-2.5 px-4 pb-2 pt-3.5">
          <span className={cn(platform === "linkedin" && "[&>*]:!rounded-md")}>
            <BrandAvatar brand={brand} size={44} />
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-semibold text-foreground">{brand.name}</p>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              {platform === "linkedin" ? "Company page · " : ""}Just now ·
              <Globe className="size-3" />
            </p>
          </div>
          {badge}
          <MoreHorizontal className="size-4 text-muted-foreground" aria-hidden />
        </header>
        <div className="px-4 pb-3">{body()}</div>
        {mediaNode(false)}
        <div className="mx-4 flex items-center justify-around border-t border-border py-1.5 text-xs font-medium text-muted-foreground">
          {[
            [ThumbsUp, "Like"],
            [MessageCircle, "Comment"],
            [Repeat2, platform === "linkedin" ? "Repost" : "Share"],
            ...(platform === "linkedin" ? [[Send, "Send"] as const] : []),
          ].map(([Icon, label]) => (
            <span key={label as string} className="flex items-center gap-1.5 px-2 py-1.5">
              <Icon className="size-4" />
              <span className="hidden sm:inline">{label as string}</span>
            </span>
          ))}
        </div>
      </article>
    );
  }

  const pct = Math.min(1, length / spec.maxChars);

  return (
    <div className="mx-auto w-full max-w-[500px]">
      <div
        className={cn(
          "overflow-hidden rounded-2xl bg-surface-3 shadow-3 ring-1 transition-shadow duration-[--motion-duration-slow]",
          editing ? "ring-primary-border" : "ring-border/70",
        )}
      >
        {card}
      </div>
      <div className="mt-3 flex items-center gap-3 px-1 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          {editing
            ? `Editing the ${spec.label} version`
            : length > fold
              ? `${spec.label} shows the first ${fold} characters before “more”`
              : `Fits ${spec.label} without a fold`}
        </span>
        <span
          className="h-1 w-14 shrink-0 overflow-hidden rounded-full bg-foreground/10"
          aria-hidden
        >
          <span
            className={cn("block h-full rounded-full", over ? "bg-danger" : "bg-primary")}
            style={{ width: `${Math.max(4, pct * 100)}%` }}
          />
        </span>
        <span className={cn("shrink-0 tabular-nums", over && "font-medium text-danger")}>
          {length.toLocaleString()} / {spec.maxChars.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
