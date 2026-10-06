"use client";

// Settings → AI assistants, as a picture: Mellox on one side, the assistants
// on the other, and a line between them that moves while access is on.
// Presentational: /connections-lab renders it with sample data.
import { useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  Lock,
  Pencil,
} from "@/components/icons";
import { Logo } from "@/components/brand/Logo";
import { McpMark } from "@/components/brand/AppMarks";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { GroupLabel } from "@/components/app/surface/SurfaceLayout";
import { cn } from "@/lib/utils";
import { ConnectionLogo, ConnectionStatus } from "./ConnectionCard";

export type McpTool = { title: string; write: boolean };
export type McpActivityItem = { id: string; title: string; ok: boolean; createdAt: string };

const EASE = [0.16, 1, 0.3, 1] as const;

const ASSISTANTS = [
  {
    id: "claude",
    name: "Claude",
    path: ["Customize", "Connectors", "Add custom connector"],
    help: "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp",
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    path: ["Settings", "Apps", "Create"],
    help: "https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt",
  },
  {
    id: "other",
    name: "Other",
    path: ["Add a remote MCP server"],
    help: null,
  },
] as const;
type AssistantId = (typeof ASSISTANTS)[number]["id"];

function AssistantMark({ id, size = 44 }: { id: AssistantId; size?: number }) {
  if (id === "claude")
    return (
      <Image
        src="/assets/assistant-connectors/claude.svg"
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-[30%]"
      />
    );
  const inner = Math.round(size * 0.55);
  return (
    <ConnectionLogo className="rounded-[30%]">
      {id === "chatgpt" ? (
        <>
          <Image
            src="/assets/assistant-connectors/openai-blossom-black.svg"
            alt=""
            width={inner}
            height={inner}
            className="dark:hidden"
          />
          <Image
            src="/assets/assistant-connectors/openai-blossom-white.svg"
            alt=""
            width={inner}
            height={inner}
            className="hidden dark:block"
          />
        </>
      ) : (
        <McpMark className="size-5" />
      )}
    </ConnectionLogo>
  );
}

/** The same marks, small, for the tabs. */
function AssistantGlyph({ id }: { id: AssistantId }) {
  if (id === "claude")
    return (
      <Image
        src="/assets/assistant-connectors/claude.svg"
        alt=""
        width={18}
        height={18}
        className="rounded-[30%]"
      />
    );
  if (id === "other") return <McpMark className="size-4" />;
  return (
    <>
      <Image
        src="/assets/assistant-connectors/openai-blossom-black.svg"
        alt=""
        width={16}
        height={16}
        className="dark:hidden"
      />
      <Image
        src="/assets/assistant-connectors/openai-blossom-white.svg"
        alt=""
        width={16}
        height={16}
        className="hidden dark:block"
      />
    </>
  );
}

function relative(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Dots that travel along the line: out for reading, back for changes. */
function Flow({ on, both }: { on: boolean; both: boolean }) {
  return (
    <div className="relative h-11 min-w-10 flex-1" aria-hidden>
      <div
        className={cn(
          "absolute inset-x-0 top-1/2 h-px -translate-y-1/2 transition-colors duration-500",
          on
            ? "bg-gradient-to-r from-primary/60 via-primary/25 to-primary/60"
            : "bg-[var(--ds-tile-border)]",
        )}
      />
      {on &&
        [0, 1, 2].map((i) => (
          <motion.span
            key={`out-${i}`}
            className="absolute top-1/2 -mt-[3px] size-1.5 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.8)]"
            initial={{ left: "0%", opacity: 0 }}
            animate={{ left: ["0%", "100%"], opacity: [0, 1, 1, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.8, ease: "linear" }}
          />
        ))}
      {on && both && (
        <motion.span
          className="absolute top-1/2 mt-[3px] size-1.5 rounded-full bg-foreground/50"
          initial={{ left: "100%", opacity: 0 }}
          animate={{ left: ["100%", "0%"], opacity: [0, 1, 1, 0] }}
          transition={{ duration: 3.2, repeat: Infinity, delay: 0.4, ease: "linear" }}
        />
      )}
    </div>
  );
}

function Permission({
  icon: Icon,
  title,
  hint,
  tools,
  active,
  control,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint: string;
  tools: string[];
  active: boolean;
  control: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("ds-tile p-4 transition-opacity duration-300", !active && "opacity-60")}>
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-full transition-colors duration-300",
            active ? "bg-primary/15 text-primary" : "bg-[var(--ds-well-bg)] text-muted-foreground",
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-foreground">{title}</p>
          <p className="truncate text-[12.5px] text-muted-foreground">{hint}</p>
        </div>
        {control}
      </div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="mt-3 inline-flex items-center gap-1 rounded-full text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        {tools.length} things it can do
        <ChevronDown
          className={cn("size-3.5 transition-transform duration-300", open && "rotate-180")}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: EASE }}
            className="overflow-hidden"
          >
            <ul className="flex flex-wrap gap-1.5 pt-2.5">
              {tools.map((tool) => (
                <li
                  key={tool}
                  className="rounded-full bg-[var(--ds-well-bg)] px-2.5 py-1 text-[12px] text-foreground/80"
                >
                  {tool}
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StepRow({
  n,
  title,
  last,
  children,
}: {
  n: number;
  title: string;
  last?: boolean;
  children?: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
      <div className="flex flex-col items-center">
        <span className="grid size-6 place-items-center rounded-full bg-primary/15 text-[12px] font-semibold text-foreground">
          {n}
        </span>
        {!last && <span className="mt-1 w-px flex-1 bg-[var(--ds-tile-border)]" aria-hidden />}
      </div>
      <div className={cn("min-w-0", !last && "pb-5")}>
        <p className="text-[13.5px] font-medium leading-6 text-foreground">{title}</p>
        {children && <div className="mt-2">{children}</div>}
      </div>
    </li>
  );
}

export function McpScreen({
  enabled,
  allowWrites,
  canManage,
  saving,
  serverUrl,
  tools,
  activity,
  onChange,
  onCopy,
}: {
  enabled: boolean;
  allowWrites: boolean;
  canManage: boolean;
  saving: boolean;
  serverUrl: string;
  tools: McpTool[];
  /** `null` while loading; leave undefined to hide the list. */
  activity?: McpActivityItem[] | null;
  onChange: (next: { enabled: boolean; allowWrites: boolean }) => void;
  /** Resolves true when the link reached the clipboard. */
  onCopy: () => Promise<boolean>;
}) {
  const [assistant, setAssistant] = useState<AssistantId>("claude");
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const reads = tools.filter((t) => !t.write).map((t) => t.title);
  const changes = tools.filter((t) => t.write).map((t) => t.title);
  const current = ASSISTANTS.find((a) => a.id === assistant) ?? ASSISTANTS[0];

  const copy = async () => {
    if (!(await onCopy())) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1800);
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="ds-enter">
        {/* The picture: Mellox, the line, the assistants. */}
        <div className="ds-tile relative overflow-hidden p-5 sm:p-6">
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute -top-24 left-1/2 size-64 -translate-x-1/2 rounded-full bg-primary/20 blur-3xl transition-opacity duration-700",
              enabled ? "opacity-100" : "opacity-0",
            )}
          />
          <div className="relative flex items-center gap-3 sm:gap-4">
            <div
              className={cn(
                "grid size-14 shrink-0 place-items-center rounded-[18px] bg-background ring-1 transition-shadow duration-500",
                enabled
                  ? "shadow-[0_0_0_4px_hsl(var(--primary)/0.14)] ring-primary/50"
                  : "ring-[var(--ds-tile-border)]",
              )}
            >
              <Logo markOnly height={26} />
            </div>
            <Flow on={enabled} both={allowWrites} />
            <div
              className={cn(
                "flex shrink-0 items-center -space-x-2 transition-[filter,opacity] duration-500",
                !enabled && "opacity-60 grayscale",
              )}
            >
              {ASSISTANTS.map((a, i) => (
                <motion.div
                  key={a.id}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.4, delay: 0.08 * i, ease: EASE }}
                  className="rounded-[30%] ring-4 ring-[var(--ds-tile-bg)]"
                  style={{ zIndex: ASSISTANTS.length - i }}
                >
                  <AssistantMark id={a.id} />
                </motion.div>
              ))}
            </div>
          </div>
          <div className="relative mt-5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[15px] font-semibold text-foreground">Use Mellox in your AI</p>
                <ConnectionStatus
                  tone={enabled ? "connected" : "off"}
                  text={enabled ? "On" : "Off"}
                />
              </div>
              <p className="mt-0.5 text-[13px] text-muted-foreground">Claude, ChatGPT and more</p>
            </div>
            <Switch
              checked={enabled}
              disabled={!canManage || saving}
              onCheckedChange={(v) => onChange({ enabled: v, allowWrites: v && allowWrites })}
              aria-label="Let AI assistants use this workspace"
            />
          </div>
        </div>
        {!canManage && (
          <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <Lock className="size-3.5" aria-hidden /> Only an admin can change this
          </p>
        )}

        <GroupLabel>What it can do</GroupLabel>
        <div className="grid gap-3 sm:grid-cols-2">
          <Permission
            icon={Eye}
            title="Read"
            hint="Content, calendar and results"
            tools={reads}
            active={enabled}
            control={
              enabled ? (
                <span className="grid size-6 place-items-center rounded-full bg-primary text-primary-foreground">
                  <Check className="size-3.5" aria-label="On" />
                </span>
              ) : null
            }
          />
          <Permission
            icon={Pencil}
            title="Make changes"
            hint="Create and post · uses credits"
            tools={changes}
            active={enabled && allowWrites}
            control={
              <Switch
                checked={allowWrites}
                disabled={!canManage || !enabled || saving}
                onCheckedChange={(v) => onChange({ enabled, allowWrites: v })}
                aria-label="Let them make changes"
              />
            }
          />
        </div>

        <AnimatePresence initial={false}>
          {enabled && (
            <motion.div
              key="connect"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.36, ease: EASE }}
              className="overflow-hidden"
            >
              <div className="pt-7">
                <GroupLabel>Connect</GroupLabel>
                <div className="ds-tile p-4 sm:p-5">
                  <div
                    className="ds-well grid grid-cols-3 gap-1 rounded-full p-1"
                    role="tablist"
                    aria-label="Assistant"
                  >
                    {ASSISTANTS.map((a) => {
                      const selected = a.id === assistant;
                      return (
                        <button
                          key={a.id}
                          type="button"
                          role="tab"
                          aria-selected={selected}
                          onClick={() => setAssistant(a.id)}
                          className={cn(
                            "relative flex h-9 items-center justify-center gap-2 rounded-full text-[13px] font-medium transition-colors",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                            selected
                              ? "text-foreground"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {selected && (
                            <motion.span
                              layoutId="mcp-assistant"
                              aria-hidden
                              transition={{ type: "spring", stiffness: 420, damping: 36 }}
                              className="absolute inset-0 rounded-full bg-[var(--ds-tile-bg)] shadow-sm ring-1 ring-[var(--ds-tile-border)]"
                            />
                          )}
                          <span className="relative inline-flex items-center gap-2">
                            <AssistantGlyph id={a.id} />
                            {a.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <ol className="mt-5">
                    <StepRow n={1} title="Copy your Mellox link">
                      <div className="flex items-center gap-2">
                        <code className="ds-well min-w-0 flex-1 truncate rounded-full px-4 py-2 text-[13px] text-foreground">
                          {serverUrl}
                        </code>
                        <Button size="sm" onClick={() => void copy()} className="shrink-0">
                          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                          {copied ? "Copied" : "Copy"}
                        </Button>
                      </div>
                    </StepRow>
                    <StepRow
                      n={2}
                      title={`Paste it in ${current.id === "other" ? "your app" : current.name}`}
                    >
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.div
                          key={current.id}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.18 }}
                          className="flex flex-wrap items-center gap-1.5"
                        >
                          {current.path.map((part, i) => (
                            <span key={part} className="inline-flex items-center gap-1.5">
                              {i > 0 && (
                                <ChevronRight
                                  className="size-3.5 text-muted-foreground"
                                  aria-hidden
                                />
                              )}
                              <span className="rounded-full bg-[var(--ds-well-bg)] px-2.5 py-1 text-[12.5px] font-medium text-foreground">
                                {part}
                              </span>
                            </span>
                          ))}
                          <span className="ml-1 text-[12.5px] text-muted-foreground">
                            Name it{" "}
                            <strong className="font-medium text-foreground">Mellox AI</strong>
                          </span>
                        </motion.div>
                      </AnimatePresence>
                    </StepRow>
                    <StepRow n={3} title="Sign in with your Mellox account" last />
                  </ol>

                  {current.help && (
                    <a
                      href={current.help}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
                    >
                      {current.name} guide <ExternalLink className="size-3.5" aria-hidden />
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  )}
                </div>

                {activity !== undefined && (
                  <>
                    <GroupLabel>Recent</GroupLabel>
                    <div className="ds-tile overflow-hidden">
                      {activity === null ? (
                        <Skeleton className="m-4 h-16 rounded-[16px]" />
                      ) : activity.length ? (
                        <ul className="divide-y divide-[var(--ds-tile-border)]">
                          {activity.map((item) => (
                            <li
                              key={item.id}
                              className="flex items-center gap-3 px-4 py-3 text-[13px] sm:px-5"
                            >
                              <span
                                className={cn(
                                  "size-2 shrink-0 rounded-full",
                                  item.ok ? "bg-success" : "bg-warning",
                                )}
                                aria-hidden
                              />
                              <span className="min-w-0 flex-1 truncate text-foreground">
                                {item.title}
                              </span>
                              {!item.ok && (
                                <span className="shrink-0 text-[12px] text-warning">
                                  Didn&apos;t work
                                </span>
                              )}
                              <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                                {relative(item.createdAt)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="px-4 py-5 text-center text-[13px] text-muted-foreground sm:px-5">
                          Nothing yet
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
