"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bookmark, Heart, MessageCircle, MoreHorizontal, Repeat2, Send } from "@/components/icons";
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

function Actions({ platform }: { platform: PlatformId }) {
  const cls = "size-4";
  if (platform === "instagram") {
    return (
      <div className="flex items-center gap-4 text-foreground/70">
        <Heart className={cls} />
        <MessageCircle className={cls} />
        <Send className={cls} />
        <Bookmark className={cn(cls, "ml-auto")} />
      </div>
    );
  }
  if (platform === "twitter" || platform === "threads") {
    return (
      <div className="flex items-center gap-8 text-foreground/60">
        <MessageCircle className={cls} />
        <Repeat2 className={cls} />
        <Heart className={cls} />
      </div>
    );
  }
  return (
    <div className="flex items-center justify-around border-t border-border pt-2 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <Heart className={cls} /> Like
      </span>
      <span className="flex items-center gap-1.5">
        <MessageCircle className={cls} /> Comment
      </span>
      <span className="flex items-center gap-1.5">
        <Repeat2 className={cls} /> Share
      </span>
    </div>
  );
}

/**
 * A believable rendering of the post as it will appear in the platform's feed:
 * the right chrome, the real fold, the media at its real ratio. Editing happens
 * in place.
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
  const spec = PLATFORMS[variant.platform];
  const Icon = spec.icon;
  const [expanded, setExpanded] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fold = FOLD[variant.platform];
  const over = variant.body.length > spec.maxChars;
  const folded = !expanded && variant.body.length > fold + 20;
  const visible = folded ? `${variant.body.slice(0, fold).trimEnd()}…` : variant.body;

  useEffect(() => setExpanded(false), [variant.platform]);
  useEffect(() => {
    if (editing) textarea.current?.focus();
  }, [editing]);

  const showMediaFirst = variant.platform === "instagram" || variant.platform === "tiktok";
  const mediaNode =
    media || ratio ? (
      <MediaFrame
        media={media}
        ratio={media?.ratio ?? ratio ?? "1:1"}
        alt={variant.title}
        onRetry={onRetryMedia}
        onExpand={onExpand}
        rounded={!showMediaFirst}
        maxHeight={480}
      />
    ) : null;

  return (
    <article className="mx-auto w-full max-w-[520px] overflow-hidden rounded-2xl border border-border bg-surface-3 shadow-1">
      <header className="flex items-center gap-2.5 px-4 pb-2 pt-3.5">
        <BrandAvatar brand={brand} size={variant.platform === "instagram" ? 30 : 40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{brand.name}</p>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Icon className="size-3" style={{ color: spec.color }} />
            {spec.label}
            {variant.platform === "linkedin" ? " · Just now" : null}
          </p>
        </div>
        {badge}
        <MoreHorizontal className="size-4 text-muted-foreground" aria-hidden />
      </header>

      {showMediaFirst && mediaNode ? <div className="mb-3">{mediaNode}</div> : null}

      <div className="px-4">
        {editing ? (
          <textarea
            ref={textarea}
            value={variant.body}
            onChange={(e) => onChange?.(e.target.value)}
            aria-label={`${spec.label} caption`}
            rows={Math.min(16, Math.max(5, Math.ceil(variant.body.length / 60)))}
            className="w-full resize-y rounded-lg border border-input bg-surface-1 p-3 text-sm leading-relaxed text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/55"
          />
        ) : (
          <div className="text-sm leading-relaxed text-foreground [&_a]:text-primary [&_p]:my-0 [&_p+p]:mt-3">
            <div className="whitespace-pre-wrap break-words">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{ p: ({ children }) => <p>{children}</p> }}
              >
                {visible}
              </ReactMarkdown>
            </div>
            {folded ? (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="mt-1 text-sm text-muted-foreground hover:text-foreground"
              >
                {variant.platform === "linkedin" ? "…see more" : "more"}
              </button>
            ) : null}
          </div>
        )}
        <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            {variant.body.length > fold && !editing
              ? `First ${fold} characters show before the fold`
              : " "}
          </span>
          <span className={cn("tabular-nums", over && "font-medium text-danger")}>
            {variant.body.length.toLocaleString()} / {spec.maxChars.toLocaleString()}
          </span>
        </div>
      </div>

      {!showMediaFirst && mediaNode ? <div className="mt-3 px-4">{mediaNode}</div> : null}

      <footer className="px-4 pb-3 pt-3">
        <Actions platform={variant.platform} />
      </footer>
    </article>
  );
}
