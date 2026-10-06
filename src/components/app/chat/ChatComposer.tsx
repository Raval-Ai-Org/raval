"use client";

import { openFeatureUpgrade } from "@/components/app/FeatureGate";
import { PlanLock } from "@/components/app/billing/billing-ui";
import { useEntitlements } from "@/lib/billing/use-entitlements";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUp,
  Check,
  ChevronDown,
  File as FileIcon,
  FileImage,
  FileSpreadsheet,
  FileText,
  Paperclip,
  Plus,
  X,
} from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { niceSize, type Attachment } from "@/lib/file-extract";

export const CHAT_MODELS: { id: string; label: string; shortLabel: string; hint: string }[] = [
  { id: "mellox-flash", label: "Mellox Flash", shortLabel: "Flash", hint: "Fast answers" },
  { id: "mellox-pro", label: "Mellox Pro", shortLabel: "Pro", hint: "Deeper thinking" },
];

export type ChatComposerHandle = { focus: () => void };

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  onAddFiles: (files: FileList | File[]) => void;
  onRemoveAttachment: (id: string) => void;
  attachments: Attachment[];
  streaming: boolean;
  busy: boolean;
  modelId: string;
  onModelChange: (id: string) => void;
  placeholder: string;
  hero?: boolean;
  /** Extra control next to "Add files" (the Autopilot switch). */
  toolbarSlot?: React.ReactNode;
  /** Shown in place of the text box and its toolbar (Autopilot, while it is on). */
  cover?: React.ReactNode;
  /** Lights the box while Autopilot runs. */
  autopilot?: "on" | "paused" | "setup" | "off" | null;
};

export const ChatComposer = forwardRef<ChatComposerHandle, Props>(function ChatComposer(
  {
    value,
    onChange,
    onSend,
    onStop,
    onAddFiles,
    onRemoveAttachment,
    attachments,
    streaming,
    busy,
    modelId,
    onModelChange,
    placeholder,
    hero,
    toolbarSlot,
    cover,
    autopilot,
  },
  ref,
) {
  const covered = Boolean(cover);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const shellRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({ focus: () => textareaRef.current?.focus() }), []);

  // Grow with the text up to ~9 lines, then scroll.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const max = hero ? 260 : 220;
    ta.style.height = `${Math.min(ta.scrollHeight, max)}px`;
    ta.style.overflowY = ta.scrollHeight > max ? "auto" : "hidden";
  }, [value, hero, covered]);

  const model = CHAT_MODELS.find((m) => m.id === modelId) ?? CHAT_MODELS[0];
  const billing = useEntitlements();
  const proGrant = billing.data?.features.pro_chat ?? null;
  const proLeft = billing.data ? billing.data.meters.pro_messages.available : null;
  const canSend = !busy && (value.trim().length > 0 || attachments.length > 0);

  const setDragging = (on: boolean) => shellRef.current?.toggleAttribute("data-dragging", on);

  return (
    <div
      ref={shellRef}
      className={cn("mx-composer group/composer", hero && "mx-composer--hero")}
      data-autopilot={autopilot && autopilot !== "off" ? autopilot : undefined}
      data-covered={covered ? "" : undefined}
      onDragEnter={(e) => {
        if (!e.dataTransfer?.types?.includes("Files")) return;
        e.preventDefault();
        dragCounter.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
      }}
      onDragLeave={() => {
        dragCounter.current -= 1;
        if (dragCounter.current <= 0) {
          dragCounter.current = 0;
          setDragging(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragCounter.current = 0;
        setDragging(false);
        if (e.dataTransfer?.files?.length) onAddFiles(e.dataTransfer.files);
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) textareaRef.current?.focus();
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onAddFiles(e.target.files);
          e.currentTarget.value = "";
        }}
      />

      {covered ? (
        <motion.div
          key="cover"
          initial={{ opacity: 0, scale: 0.985 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          className="rounded-[inherit]"
        >
          {cover}
        </motion.div>
      ) : (
        <ComposerBody>
          <AnimatePresence initial={false}>
            {attachments.length > 0 ? (
              <motion.div
                key="attachments"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <div className="flex flex-wrap gap-2 px-3 pt-3">
                  <AnimatePresence initial={false}>
                    {attachments.map((a) => (
                      <AttachmentChip key={a.id} a={a} onRemove={() => onRemoveAttachment(a.id)} />
                    ))}
                  </AnimatePresence>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              // Physical keyboards can send with Enter. On phones, Enter inserts a
              // line break; the visible Send button avoids accidental sends.
              const composing = (e.nativeEvent as KeyboardEvent).isComposing || e.keyCode === 229;
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.ctrlKey &&
                !e.metaKey &&
                !e.altKey &&
                !composing &&
                !window.matchMedia("(max-width: 767px)").matches
              ) {
                e.preventDefault();
                if (!streaming) onSend();
              }
              if (e.key === "Escape" && streaming) {
                e.preventDefault();
                onStop();
              }
            }}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files ?? []);
              if (files.length) {
                e.preventDefault();
                onAddFiles(files);
              }
            }}
            placeholder={placeholder}
            rows={1}
            aria-label="Message Mellox"
            aria-keyshortcuts="Enter Shift+Enter"
            className="mx-composer__input"
          />

          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-2.5 pb-2.5 sm:flex-nowrap">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mx-icon-btn size-8 shrink-0"
              aria-label="Add files"
              title="Add files (PDF, Word, Excel, images, text)"
            >
              <Plus className="size-[18px]" />
            </button>
            {toolbarSlot}

            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="mx-model-btn"
                    aria-label={`Model: ${model.label}`}
                  >
                    <span className="sm:hidden">{model.shortLabel}</span>
                    <span className="hidden sm:inline">{model.label}</span>
                    <ChevronDown className="size-3.5 opacity-60 transition-transform group-data-[state=open]:rotate-180" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={8} className="w-56 p-1.5">
                  {CHAT_MODELS.map((m) => {
                    // Pro is a paid plan feature with a monthly message allowance.
                    const pro = m.id === "mellox-pro";
                    const lock =
                      pro && proGrant && !proGrant.allowed ? proGrant.requiredPlan : null;
                    return (
                      <DropdownMenuItem
                        key={m.id}
                        onSelect={() =>
                          lock ? openFeatureUpgrade("pro_chat") : onModelChange(m.id)
                        }
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium">{m.label}</div>
                          <div className="text-[11.5px] text-muted-foreground">
                            {pro && !lock && proLeft !== null
                              ? `${m.hint} · ${proLeft} left`
                              : m.hint}
                          </div>
                        </div>
                        {lock ? (
                          <PlanLock plan={lock} />
                        ) : m.id === model.id ? (
                          <Check className="size-4 text-primary" />
                        ) : null}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>

              <motion.button
                type="button"
                onClick={() => (streaming ? onStop() : onSend())}
                disabled={!streaming && !canSend}
                aria-label={streaming ? "Stop" : "Send"}
                title={streaming ? "Stop (Esc)" : "Send (Enter)"}
                whileTap={{ scale: 0.9 }}
                className={cn("mx-send", streaming && "is-streaming", canSend && "is-ready")}
              >
                <AnimatePresence mode="wait" initial={false}>
                  {streaming ? (
                    <motion.span
                      key="stop"
                      initial={{ scale: 0.4, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.4, opacity: 0 }}
                      transition={{ duration: 0.16 }}
                      className="block size-2.5 rounded-[3px] bg-current"
                    />
                  ) : (
                    <motion.span
                      key="send"
                      initial={{ y: 6, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: -6, opacity: 0 }}
                      transition={{ duration: 0.16 }}
                      className="grid place-items-center"
                    >
                      <ArrowUp className="size-[18px]" strokeWidth={2.4} />
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.button>
            </div>
          </div>
        </ComposerBody>
      )}

      <div className="mx-composer__drop" aria-hidden>
        <Paperclip className="size-4" />
        Drop files to add them
      </div>
    </div>
  );
});

/** The text box and its toolbar, fading in when the box is handed back. */
function ComposerBody({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="flex flex-col"
    >
      {children}
    </motion.div>
  );
}

function AttachmentChip({ a, onRemove }: { a: Attachment; onRemove: () => void }) {
  const Icon =
    a.kind === "image"
      ? FileImage
      : a.kind === "xlsx"
        ? FileSpreadsheet
        : a.kind === "pdf" || a.kind === "docx" || a.kind === "text"
          ? FileText
          : FileIcon;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.18 }}
      className={cn(
        "group/chip relative flex max-w-[220px] items-center gap-2 rounded-xl border py-1.5 pl-1.5 pr-2 text-[12px]",
        a.status === "error"
          ? "border-danger-border bg-danger-surface"
          : "border-border bg-muted/60",
      )}
      title={a.status === "error" ? a.error : `${a.name} · ${niceSize(a.size)}`}
    >
      {a.preview ? (
        <img src={a.preview} alt="" className="size-8 rounded-lg object-cover" />
      ) : (
        <span className="grid size-8 place-items-center rounded-lg bg-background text-muted-foreground">
          {a.status === "reading" ? (
            <span className="composer-skel-chip size-4" aria-hidden />
          ) : (
            <Icon className="size-4" />
          )}
        </span>
      )}
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate font-medium text-foreground">{a.name}</span>
        <span className="text-[10.5px] text-muted-foreground">
          {a.status === "reading"
            ? "Reading…"
            : a.status === "error"
              ? "Couldn't read"
              : `${a.kind.toUpperCase()} · ${niceSize(a.size)}`}
        </span>
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${a.name}`}
        className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border border-border bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/chip:opacity-100 [@media(hover:none)]:opacity-100"
      >
        <X className="size-3" />
      </button>
    </motion.div>
  );
}
