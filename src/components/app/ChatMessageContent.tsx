"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useState, isValidElement, Children, memo } from "react";
import { Check, Copy, Zap, ArrowRight, ListChecks, Info } from "@/components/ui/gemini-icons";

function CodeBlock({ children, className }: { children: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const lang = className?.replace("language-", "") || "code";
  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-border/70 bg-background">
      <div className="flex items-center justify-between border-b border-border/60 bg-secondary/40 px-3 py-1">
        <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {lang}
        </span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(children);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }}
          aria-label={copied ? "Copied" : "Copy code"}
          className="chat-focus flex items-center gap-1 rounded px-1.5 py-0.5 font-sans text-[10px] text-muted-foreground transition hover:bg-background hover:text-foreground"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed">
        <code>{children}</code>
      </pre>
    </div>
  );
}

function getText(node: any): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getText).join("");
  if (isValidElement(node)) return getText((node.props as any)?.children);
  return "";
}

function stripLeadingLabel(children: any, re: RegExp): any {
  const arr = Children.toArray(children);
  if (!arr.length) return children;
  const first = arr[0];
  if (typeof first === "string") {
    return [first.replace(re, ""), ...arr.slice(1)];
  }
  if (isValidElement(first) && (first.type === "strong" || first.type === "b")) {
    return arr
      .slice(1)
      .map((n, i) => (i === 0 && typeof n === "string" ? n.replace(/^\s+/, "") : n));
  }
  return arr;
}

function renderParagraph(children: any) {
  const text = getText(children).trim();

  if (/^TL;DR\s*:/i.test(text)) {
    return (
      <div className="chat-callout chat-callout--accent my-2.5">
        <Zap className="chat-callout__icon h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
        <p className="chat-callout__body">{stripLeadingLabel(children, /^TL;DR\s*:\s*/i)}</p>
      </div>
    );
  }

  if (/^Next step\s*:/i.test(text)) {
    return (
      <div className="chat-callout chat-callout--next mt-3">
        <ArrowRight className="chat-callout__icon h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
        <p className="chat-callout__body">{stripLeadingLabel(children, /^Next step\s*:\s*/i)}</p>
      </div>
    );
  }

  if (/^(Note|Tip|Heads up|Warning)\s*:/i.test(text)) {
    return (
      <div className="chat-callout my-2">
        <Info className="chat-callout__icon h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
        <p className="chat-callout__body" style={{ fontWeight: 400 }}>
          {children}
        </p>
      </div>
    );
  }

  return <p>{children}</p>;
}

function ChatMessageContentInner({
  content,
  role,
}: {
  content: string;
  role: "user" | "assistant" | "system";
}) {
  if (role === "user") {
    const choicesMatch = content.match(/^My choices:\s*\n([\s\S]+)$/);
    if (choicesMatch) {
      const rows = choicesMatch[1]
        .split("\n")
        .map((l) => l.replace(/^[-*]\s*/, "").trim())
        .filter(Boolean)
        .map((l) => {
          const idx = l.lastIndexOf(":");
          if (idx === -1) return { q: l, a: "" };
          return {
            q: l.slice(0, idx).trim().replace(/\?$/, ""),
            a: l.slice(idx + 1).trim(),
          };
        });
      return (
        <div className="choices-card">
          <div className="choices-card__eyebrow">
            <Check className="h-3 w-3" strokeWidth={2.5} aria-hidden /> My choices
          </div>
          <ul className="choices-card__list">
            {rows.map((r, i) => (
              <li key={i} className="choices-card__row">
                <span className="choices-card__q">{r.q}</span>
                <span className="choices-card__a">{r.a}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    return (
      <div className="whitespace-pre-wrap break-words font-medium tracking-[-0.005em]">
        {content}
      </div>
    );
  }

  return (
    <div className="chat-md break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => renderParagraph(children),
          h1: ({ children }) => <h1>{children}</h1>,
          h2: ({ children }) => {
            const text = getText(children);
            const isPlan = /^plan\b/i.test(text);
            const isKey = /key\s*points?/i.test(text);
            const Icon = isPlan ? ArrowRight : isKey ? ListChecks : null;
            return (
              <div className="chat-eyebrow">
                {Icon && <Icon className="h-3 w-3" strokeWidth={2.25} aria-hidden />}
                {children}
              </div>
            );
          },
          h3: ({ children }) => {
            const text = getText(children);
            const isPlan = /^plan\b/i.test(text);
            const isKey = /key\s*points?/i.test(text);
            const Icon = isPlan ? ArrowRight : isKey ? ListChecks : null;
            return (
              <div className="chat-eyebrow">
                {Icon && <Icon className="h-3 w-3" strokeWidth={2.25} aria-hidden />}
                {children}
              </div>
            );
          },
          ul: ({ children }) => <ul>{children}</ul>,
          ol: ({ children }) => <ol className="space-y-1.5 [counter-reset:step]">{children}</ol>,
          li: ({ children, ...props }: any) => {
            const ordered =
              (props.node?.parent?.type === "list" && props.node?.parent?.ordered) ?? false;
            if (ordered) {
              return (
                <li className="relative flex gap-2.5 leading-snug before:mt-[3px] before:grid before:h-[18px] before:w-[18px] before:shrink-0 before:place-items-center before:rounded-full before:bg-secondary before:font-sans before:text-[10px] before:font-semibold before:text-foreground/75 before:[counter-increment:step] before:[content:counter(step)]">
                  <span className="min-w-0 flex-1">{children}</span>
                </li>
              );
            }
            return (
              <li className="relative flex gap-2 py-px leading-snug">
                <span
                  aria-hidden
                  className="mt-[9px] h-[5px] w-[5px] shrink-0 rounded-full bg-foreground/45"
                />
                <span className="min-w-0 flex-1">{children}</span>
              </li>
            );
          },
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          em: ({ children }) => <em className="italic text-foreground/90">{children}</em>,
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="chat-focus rounded font-medium text-foreground underline decoration-foreground/30 underline-offset-[3px] transition hover:decoration-foreground"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-border bg-secondary/30 px-3 py-1.5 text-foreground/90">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-border/50" />,
          table: ({ children }) => (
            <div className="my-2.5 overflow-x-auto rounded-lg border border-border/70">
              <table className="w-full text-[12px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-secondary/60">{children}</thead>,
          th: ({ children }) => (
            <th className="border-b border-border/60 px-2.5 py-1.5 text-left font-sans text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-border/40 px-2.5 py-1.5 last:border-b-0">{children}</td>
          ),
          code: ({ className, children, ...props }: any) => {
            const isInline = !className;
            if (isInline) {
              return (
                <code
                  className="rounded bg-secondary px-1 py-px font-mono text-[11.5px] text-foreground"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <CodeBlock className={className}>{String(children).replace(/\n$/, "")}</CodeBlock>
            );
          },
          pre: ({ children }) => <>{children}</>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const ChatMessageContent = memo(
  ChatMessageContentInner,
  (a, b) => a.content === b.content && a.role === b.role,
);
