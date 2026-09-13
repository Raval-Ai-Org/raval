"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import type { ArticleOutput } from "@/lib/studio/jobs";
import { BrandAvatar, type PreviewBrand } from "./brand";

function readingTime(words: number) {
  return Math.max(1, Math.round(words / 230));
}

function countWords(markdown: string) {
  return markdown.split(/\s+/).filter(Boolean).length;
}

const today = () =>
  new Date().toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });

/**
 * The article as a published page on the brand's blog — site header, headline,
 * byline, takeaways and an edited reading measure. Editing is a two-sheet
 * writer's view: markdown on the left, the page on the right.
 */
export function ArticlePreview({
  article,
  brand,
  kicker,
  editing,
  onChange,
}: {
  article: ArticleOutput;
  brand: PreviewBrand;
  kicker?: string;
  editing?: boolean;
  onChange?: (patch: Partial<ArticleOutput>) => void;
}) {
  const words = countWords(article.markdown);

  if (editing) {
    return (
      <div className="mx-auto grid w-full max-w-[1180px] items-start gap-6 xl:grid-cols-2">
        <div className="overflow-hidden rounded-2xl bg-surface-3 shadow-3 ring-1 ring-primary-border">
          <div className="flex h-11 items-center gap-2 border-b border-border/70 px-6">
            <span className="ui-eyebrow">Writer</span>
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {words.toLocaleString()} words · {readingTime(words)} min read
            </span>
          </div>
          <div className="px-6 pt-6">
            <textarea
              value={article.title}
              onChange={(e) => onChange?.({ title: e.target.value.replace(/\n/g, " ") })}
              aria-label="Headline"
              rows={2}
              className="block w-full resize-none bg-transparent text-2xl font-semibold leading-tight tracking-tight text-foreground outline-none placeholder:text-muted-foreground"
              placeholder="Headline"
            />
            <textarea
              value={article.dek}
              onChange={(e) => onChange?.({ dek: e.target.value.replace(/\n/g, " ") })}
              aria-label="Subtitle"
              rows={2}
              className="mt-2 block w-full resize-none bg-transparent text-base leading-relaxed text-muted-foreground outline-none placeholder:text-muted-foreground/60"
              placeholder="Subtitle"
            />
          </div>
          <div className="mx-6 mt-4 border-t border-border/70" />
          <textarea
            value={article.markdown}
            onChange={(e) => onChange?.({ markdown: e.target.value })}
            aria-label="Article body (Markdown)"
            className="block min-h-[520px] w-full resize-y bg-transparent px-6 py-5 font-mono text-[13px] leading-[1.8] text-foreground outline-none"
          />
        </div>
        <div className="hidden xl:sticky xl:top-20 xl:block">
          <p className="ui-eyebrow mb-3 px-1">Live page</p>
          <div className="max-h-[calc(100dvh-14rem)] overflow-y-auto rounded-2xl">
            <ArticleSheet article={article} brand={brand} kicker={kicker} words={words} compact />
          </div>
        </div>
      </div>
    );
  }

  return <ArticleSheet article={article} brand={brand} kicker={kicker} words={words} />;
}

function ArticleSheet({
  article,
  brand,
  kicker,
  words,
  compact,
}: {
  article: ArticleOutput;
  brand: PreviewBrand;
  kicker?: string;
  words: number;
  compact?: boolean;
}) {
  return (
    <div className="mx-auto w-full max-w-[780px] overflow-hidden rounded-2xl bg-surface-3 shadow-3 ring-1 ring-border/70">
      <div className="flex h-12 items-center gap-2.5 border-b border-border/70 px-5 sm:px-8">
        <BrandAvatar brand={brand} size={22} />
        <span className="truncate text-sm font-semibold tracking-tight text-foreground">
          {brand.name}
        </span>
        <span className="ml-3 hidden gap-4 text-xs text-muted-foreground sm:flex">
          <span className="text-foreground">Blog</span>
          <span>Guides</span>
          <span>About</span>
        </span>
        <span className="ml-auto inline-flex h-7 items-center rounded-full bg-foreground px-3 text-xs font-medium text-background">
          Subscribe
        </span>
      </div>

      <article className={cn("px-6 py-10", compact ? "sm:px-10 sm:py-12" : "sm:px-16 sm:py-16")}>
        <div className="mx-auto max-w-[640px]">
          {kicker ? (
            <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <span aria-hidden className="size-1.5 rounded-full bg-primary" />
              {kicker}
            </p>
          ) : null}
          <h1
            className={cn(
              "mt-4 text-balance font-semibold leading-[1.1] tracking-[-0.028em] text-foreground",
              compact ? "text-[1.9rem]" : "text-[clamp(1.9rem,4.2vw,2.75rem)]",
            )}
          >
            {article.title}
          </h1>
          {article.dek ? (
            <p className="mt-4 text-pretty text-lg leading-relaxed text-muted-foreground sm:text-[1.2rem]">
              {article.dek}
            </p>
          ) : null}

          <div className="mt-8 flex items-center gap-3 border-b border-border/70 pb-8">
            <BrandAvatar brand={brand} size={36} />
            <div className="min-w-0 leading-tight">
              <p className="text-sm font-medium text-foreground">{brand.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {today()} · {readingTime(words)} min read
              </p>
            </div>
          </div>

          {article.takeaways.length ? (
            <aside className="mt-9 rounded-xl bg-surface-2/70 p-5 sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground/70">
                Key takeaways
              </p>
              <ol className="mt-3.5 space-y-2.5">
                {article.takeaways.map((t, i) => (
                  <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-foreground">
                    <span className="mt-[3px] grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[10.5px] font-semibold tabular-nums text-primary-foreground">
                      {i + 1}
                    </span>
                    {t}
                  </li>
                ))}
              </ol>
            </aside>
          ) : null}

          <div className="studio-article mt-10">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{ h1: ({ children }) => <h2>{children}</h2> }}
            >
              {article.markdown}
            </ReactMarkdown>
          </div>

          <div className="mt-14 flex justify-center" aria-hidden>
            <span className="size-2 rounded-[2px] bg-primary" />
          </div>
        </div>
      </article>
    </div>
  );
}

/** How the article appears as a search result, with the description length. */
export function SearchSnippet({ article, brand }: { article: ArticleOutput; brand: PreviewBrand }) {
  const description = article.metaDescription || article.dek;
  const len = description.length;
  const ok = len >= 70 && len <= 160;
  const domain = `${brand.name.toLowerCase().replace(/[^a-z0-9]+/g, "") || "yourbrand"}.com`;
  return (
    <div>
      <div className="rounded-xl bg-surface-2/60 p-3.5">
        <div className="flex items-center gap-2">
          <BrandAvatar brand={brand} size={20} />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-xs text-foreground">{brand.name}</p>
            <p className="truncate text-[11px] text-muted-foreground">https://{domain} › blog</p>
          </div>
        </div>
        <p className="mt-2 line-clamp-2 text-[15px] leading-snug text-[#1a0dab] dark:text-[#8ab4f8]">
          {article.title}
        </p>
        <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      <p className={cn("mt-2 text-xs", ok ? "text-muted-foreground" : "text-warning")}>
        Description {len} characters ·{" "}
        {ok ? "a good length for search" : len < 70 ? "a little short" : "may be cut off"}
      </p>
    </div>
  );
}
