"use client";

import { memo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, Copy, Paperclip, Pencil, RefreshCw } from "@/components/icons";
import { toast } from "sonner";
import { ChatMessageContent } from "@/components/app/ChatMessageContent";
import { cn } from "@/lib/utils";
import { MelloxPulse } from "./ThinkingIndicator";
import { useSmoothText } from "./use-smooth-text";

const enter = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] as const },
};

async function copyText(text: string) {
  const plain = text.replace(/\r\n/g, "\n").trim();
  if (!plain) return false;
  try {
    await navigator.clipboard.writeText(plain);
    return true;
  } catch {
    toast.error("Couldn't copy", { description: "Your browser blocked the clipboard." });
    return false;
  }
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="mx-icon-btn"
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={copied ? "y" : "n"}
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.5, opacity: 0 }}
          transition={{ duration: 0.14 }}
          className="grid place-items-center"
        >
          {copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

/** "📎 2 files: a.pdf, b.png" first line → a file row above the text. */
function splitAttachmentLine(content: string): { files: string[]; text: string } {
  const m = content.match(/^📎 \d+ files?: (.+)(?:\n\n([\s\S]*))?$/);
  if (!m) return { files: [], text: content };
  return { files: m[1].split(", ").filter(Boolean), text: m[2] ?? "" };
}

export const UserMessage = memo(function UserMessage({
  content,
  onEdit,
  animate,
}: {
  content: string;
  onEdit?: (text: string) => void;
  animate: boolean;
}) {
  const { files, text } = splitAttachmentLine(content);
  return (
    <motion.div
      {...(animate ? enter : { initial: false })}
      className="group/user flex flex-col items-end gap-1"
    >
      {files.length ? (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
          {files.map((f) => (
            <span
              key={f}
              className="inline-flex max-w-[220px] items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 text-[12px] text-muted-foreground"
            >
              <Paperclip className="size-3 shrink-0" />
              <span className="truncate">{f}</span>
            </span>
          ))}
        </div>
      ) : null}
      {text ? (
        <div className="mx-user-bubble">
          <ChatMessageContent content={text} role="user" />
        </div>
      ) : null}
      <div className="mx-msg-actions">
        <CopyButton text={text} />
        {onEdit ? (
          <button
            type="button"
            className="mx-icon-btn"
            aria-label="Edit in message box"
            title="Edit"
            onClick={() => onEdit(text)}
          >
            <Pencil className="size-3.5" />
          </button>
        ) : null}
      </div>
    </motion.div>
  );
});

export function AssistantMessage({
  content,
  streaming,
  isLast,
  reducedMotion,
  animate,
  onRetry,
  children,
}: {
  content: string;
  streaming: boolean;
  isLast: boolean;
  reducedMotion: boolean;
  animate: boolean;
  onRetry?: () => void;
  children?: React.ReactNode;
}) {
  const shown = useSmoothText(content, streaming, reducedMotion);
  const typing = streaming || shown.length < content.length;
  return (
    <motion.div
      {...(animate ? enter : { initial: false })}
      className="group/assistant flex flex-col gap-3"
      aria-busy={typing}
    >
      <div className={cn("mx-assistant", typing && "is-typing")}>
        <ChatMessageContent content={shown} role="assistant" />
      </div>
      {children}
      <div
        className={cn(
          "flex items-center gap-2",
          isLast && !typing ? "mx-msg-actions is-visible" : "mx-msg-actions",
        )}
      >
        {isLast ? <MelloxPulse active={typing} className="mr-0.5 text-primary" /> : null}
        {!typing ? (
          <>
            <CopyButton text={content} label="Copy reply" />
            {onRetry ? (
              <button
                type="button"
                className="mx-icon-btn"
                aria-label="Try again"
                title="Try again"
                onClick={onRetry}
              >
                <RefreshCw className="size-3.5" />
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </motion.div>
  );
}

export function ErrorMessage({ content, onRetry }: { content: string; onRetry?: () => void }) {
  return (
    <motion.div {...enter} role="alert" className="mx-error">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium text-foreground">That reply didn&rsquo;t finish</p>
        <p className="mt-0.5 break-words text-[13px] text-muted-foreground">{content}</p>
      </div>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="mx-pill-btn shrink-0">
          <RefreshCw className="size-3.5" />
          Try again
        </button>
      ) : null}
    </motion.div>
  );
}

export function NoticeMessage({ content }: { content: string }) {
  return (
    <motion.p {...enter} className="text-[13px] text-muted-foreground">
      {content}
    </motion.p>
  );
}
