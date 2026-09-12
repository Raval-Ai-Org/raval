"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Globe } from "@/components/icons";
import type { ArticleOutput } from "@/lib/studio/jobs";
import type { PreviewBrand } from "./brand";

function readingTime(words: number) {
  return Math.max(1, Math.round(words / 230));
}

/** A reading layout: the article as it will read on the blog, plus its search snippet. */
export function ArticlePreview({
  article,
  brand,
  editing,
  onChange,
}: {
  article: ArticleOutput;
  brand: PreviewBrand;
  editing?: boolean;
  onChange?: (patch: Partial<ArticleOutput>) => void;
}) {
  const words = article.markdown.split(/\s+/).filter(Boolean).length;

  if (editing) {
    return (
      <div className="mx-auto grid w-full max-w-5xl gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <input
            value={article.title}
            onChange={(e) => onChange?.({ title: e.target.value })}
            aria-label="Title"
            className="w-full rounded-lg border border-input bg-surface-3 px-3 py-2 text-lg font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/55"
          />
          <input
            value={article.dek}
            onChange={(e) => onChange?.({ dek: e.target.value })}
            aria-label="Subtitle"
            className="w-full rounded-lg border border-input bg-surface-3 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/55"
          />
          <textarea
            value={article.markdown}
            onChange={(e) => onChange?.({ markdown: e.target.value })}
            aria-label="Article body (Markdown)"
            className="min-h-[420px] w-full resize-y rounded-lg border border-input bg-surface-3 p-3 font-mono text-[13px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/55"
          />
          <p className="text-xs text-muted-foreground">Markdown · {words.toLocaleString()} words</p>
        </div>
        <div className="hidden max-h-[640px] overflow-y-auto rounded-xl border border-border bg-surface-3 p-6 lg:block">
          <ArticleBody article={article} />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-6">
      <div className="rounded-xl border border-border bg-surface-3 p-4">
        <p className="ui-eyebrow mb-2">Search preview</p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Globe className="size-3.5" /> {brand.name}
        </p>
        <p className="mt-1 line-clamp-1 text-base font-medium text-[#1a0dab] dark:text-[#8ab4f8]">
          {article.title}
        </p>
        <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
          {article.metaDescription || article.dek}
        </p>
      </div>

      <article className="rounded-2xl border border-border bg-surface-3 px-6 py-8 shadow-1 sm:px-10">
        <p className="text-xs text-muted-foreground">
          {words.toLocaleString()} words · {readingTime(words)} min read
        </p>
        <ArticleBody article={article} />
      </article>
    </div>
  );
}

function ArticleBody({ article }: { article: ArticleOutput }) {
  return (
    <>
      <h1 className="mt-2 text-balance text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-3xl">
        {article.title}
      </h1>
      {article.dek ? (
        <p className="mt-3 text-md leading-relaxed text-muted-foreground">{article.dek}</p>
      ) : null}
      {article.takeaways.length ? (
        <aside className="mt-6 rounded-xl bg-primary-surface p-4 ring-1 ring-primary-border">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground/80">
            Key takeaways
          </p>
          <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-foreground">
            {article.takeaways.map((t, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                {t}
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
      <div className="prose prose-neutral mt-6 max-w-none text-[15px] leading-[1.75] dark:prose-invert prose-headings:tracking-tight prose-h2:mt-10 prose-h2:text-xl prose-h3:text-lg prose-a:text-primary prose-li:my-1">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{article.markdown}</ReactMarkdown>
      </div>
    </>
  );
}
