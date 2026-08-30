import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { authedFetch } from "@/lib/authed-fetch";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowUp,
  Sparkles,
  ChevronDown,
  Square,
  Search,
  Check,
  Paperclip,
  SlidersHorizontal,
  Target,
  Globe,
  MessageSquare,
  Bot,
  Command as CmdIcon,
  Sun,
  Moon,
} from "@/components/brand/icons";
import {
  Rows3,
  Rows2,
  Zap,
  ZapOff,
  FileText,
  FileSpreadsheet,
  FileImage,
  File as FileIcon,
  X,
  Loader2,
  Plus,
} from "@/components/ui/gemini-icons";
import { Mi } from "@/components/ui/mi";
import { toast } from "sonner";
import {
  classify as classifyAttachment,
  extractAttachment,
  attachmentsToContext,
  niceSize,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  type Attachment,
} from "@/lib/file-extract";
import { recordTokens, routePromptToAgent, useAgentToggles } from "@/hooks/use-agent-toggles";
import { agentList } from "@/lib/agents";
import { BrandLogo, type BrandKey } from "@/components/brand/BrandLogo";
import { Switch } from "@/components/ui/switch";
import { Logo } from "@/components/brand/Logo";
import { ThinkingTrail } from "@/components/app/ThinkingTrail";
import { NextStepSuggestions } from "@/components/app/NextStepSuggestions";
import { ClarifyCard, type ClarifyPayload } from "@/components/app/ClarifyCard";
import { useBrandDna } from "@/hooks/use-brand-dna";
import { ChatMessageContent } from "@/components/app/ChatMessageContent";
import { buildSmartChatContext, type CtxSources } from "@/lib/ai/context-select";
import { useTheme } from "@/hooks/use-theme";
import { useChatPrefs } from "@/hooks/use-chat-prefs";
import {
  startPreviewPlan,
  completePreviewPlan,
  stopPreviewPlan,
  planFromPrompt,
} from "@/lib/preview-stages";

import { detectChatActions, runChatAction, type ChatAction } from "@/lib/chat-actions";
import type { ChatToolResult } from "@/lib/chat-tools";
import {
  Zap as ZapIcon,
  Wand2,
  BookOpen,
  CalendarDays,
  ArrowUpRight,
  CheckCircle2,
  AlertTriangle,
} from "@/components/ui/gemini-icons";

type Msg = {
  id: string;
  role: "user" | "assistant" | "system";
  kind: "text" | "approval" | "progress" | "reminder" | "clarify" | "actions";
  content: string;
  payload?: any;
};

function ActionChips({ actions }: { actions: ChatAction[] }) {
  if (!actions?.length) return null;
  const iconFor = (a: ChatAction) => {
    if (a.kind === "audit") return ZapIcon;
    if (a.kind === "memory") return BookOpen;
    if (a.kind === "calendar") return CalendarDays;
    return Wand2;
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="ml-10 mt-1 flex flex-wrap gap-1.5"
    >
      {actions.map((a, i) => {
        const Icon = iconFor(a);
        return (
          <motion.button
            key={a.label}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.04 * i }}
            onClick={() => {
              const r = runChatAction(a);
              if (r.toast) toast.success(r.toast);
            }}
            className="group inline-flex max-w-full items-center gap-1.5 rounded-full border border-foreground/15 bg-gradient-to-r from-[hsl(var(--brand-blue)/0.08)] to-[hsl(var(--brand-green)/0.08)] px-2.5 py-1 text-left text-[11.5px] font-medium text-foreground transition hover:-translate-y-0.5 hover:border-foreground/30 hover:from-[hsl(var(--brand-blue)/0.16)] hover:to-[hsl(var(--brand-green)/0.16)]"
            title={a.hint}
          >
            <Icon className="h-3 w-3 text-[hsl(var(--brand-blue))]" />
            <span className="truncate">{a.label}</span>
            <ArrowUpRight className="h-3 w-3 -translate-x-0.5 text-muted-foreground transition group-hover:translate-x-0 group-hover:text-foreground" />
          </motion.button>
        );
      })}
    </motion.div>
  );
}

function ToolResultsRow({ results }: { results: ChatToolResult[] }) {
  if (!results?.length) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="ml-10 mt-1 flex flex-wrap gap-1.5"
    >
      {results.map((r, i) => (
        <motion.div
          key={r.kind + i}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.04 * i }}
          className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium ${
            r.ok
              ? "border-[hsl(var(--brand-green)/0.35)] bg-[hsl(var(--brand-green)/0.08)] text-foreground"
              : "border-amber-500/40 bg-amber-500/10 text-foreground"
          }`}
          title={r.detail}
        >
          {r.ok ? (
            <CheckCircle2 className="h-3 w-3 text-[hsl(var(--brand-green))]" />
          ) : (
            <AlertTriangle className="h-3 w-3 text-amber-500" />
          )}
          <span className="truncate">{r.label}</span>
        </motion.div>
      ))}
    </motion.div>
  );
}

const SUGGESTIONS: { label: string; icon: any; hint: string }[] = [
  { label: "Audit my SEO + AEO visibility", icon: Search, hint: "Scan the site & search results" },
  {
    label: "Find Reddit threads to reply to",
    icon: MessageSquare,
    hint: "Surface high-intent threads",
  },
  { label: "Draft Quora answers linking my site", icon: Bot, hint: "We write, you approve" },
];

const MODELS: { id: string; label: string; hint: string }[] = [
  { id: "ravi-flash", label: "Ravi Flash", hint: "Fast · everyday ops" },
  { id: "ravi-pro", label: "Ravi Pro", hint: "Deeper reasoning" },
];

export function ChatPanel({
  workspaceId,
  variant = "rail",
  mobileAccessory,
}: {
  workspaceId: string;
  variant?: "rail" | "centered";
  mobileAccessory?: ReactNode;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [clarifying, setClarifying] = useState(false);
  const [modelId, setModelId] = useState(MODELS[0].id);
  const [modelOpen, setModelOpen] = useState(false);
  const [adaptive, setAdaptive] = useState(false);
  const [siteUrl, setSiteUrl] = useState<string | null>(null);
  const [wsStats, setWsStats] = useState<{
    pending: number;
    scheduled: number;
    published: number;
    recentTitles: string[];
  } | null>(null);
  const [coachSummary, setCoachSummary] = useState<string | null>(null);
  const [competitorSummary, setCompetitorSummary] = useState<string | null>(null);
  const model = MODELS.find((m) => m.id === modelId)!;
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);

  const addFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    const currentTotal = attachments.reduce((s, a) => s + a.size, 0);
    let running = currentTotal;
    const staged: Attachment[] = [];
    for (const f of files) {
      if (f.size > MAX_FILE_BYTES) {
        toast.error(`${f.name}: exceeds ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)}MB`);
        continue;
      }
      if (running + f.size > MAX_TOTAL_BYTES) {
        toast.error("Attachment total exceeds 40MB — remove some files");
        break;
      }
      running += f.size;
      staged.push({
        id: crypto.randomUUID(),
        file: f,
        name: f.name,
        size: f.size,
        mime: f.type || "application/octet-stream",
        kind: classifyAttachment(f),
        status: "reading",
      });
    }
    if (!staged.length) return;
    setAttachments((prev) => [...prev, ...staged]);
    for (const att of staged) {
      try {
        const { text, preview } = await extractAttachment(att.file);
        setAttachments((prev) =>
          prev.map((x) => (x.id === att.id ? { ...x, status: "ready", text, preview } : x)),
        );
      } catch (e: any) {
        setAttachments((prev) =>
          prev.map((x) =>
            x.id === att.id ? { ...x, status: "error", error: e?.message ?? "Failed to read" } : x,
          ),
        );
        toast.error(`${att.name}: ${e?.message ?? "Failed to read"}`);
      }
    }
  };

  const removeAttachment = (id: string) =>
    setAttachments((prev) => prev.filter((a) => a.id !== id));

  const onDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    dragCounter.current += 1;
    setDragging(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragging(false);
    }
  };
  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    if (e.dataTransfer?.files?.length) void addFiles(e.dataTransfer.files);
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length) {
      e.preventDefault();
      void addFiles(files);
    }
  };

  const navigate = useNavigate();
  const { isOn } = useAgentToggles();
  const { dna, save: saveDna } = useBrandDna(workspaceId);
  const dnaRef = useRef(dna);
  const messagesRef = useRef<Msg[]>([]);
  useEffect(() => {
    dnaRef.current = dna;
  }, [dna]);
  const syncingMemoryRef = useRef(false);
  const maybeSyncMemory = async () => {
    if (syncingMemoryRef.current) return;
    const current = dnaRef.current;
    const last = current.memoryLastMsgCount ?? 0;
    const liveCount = messagesRef.current.length;
    if (liveCount < 4) return;
    if (liveCount - last < 4) return;
    syncingMemoryRef.current = true;
    try {
      const { syncMemoryFromChat } = await import("@/lib/memory-sync");
      const res = await syncMemoryFromChat(workspaceId, current, saveDna);
      if (res.added > 0) {
        toast.success(`Memory updated · ${res.added} new insight${res.added > 1 ? "s" : ""}`);
      }
    } catch (e) {
      console.warn("memory sync failed", e);
    } finally {
      syncingMemoryRef.current = false;
    }
  };

  const { theme, toggle: toggleTheme } = useTheme();
  const { density, toggleDensity, reducedMotion, toggleReducedMotion } = useChatPrefs();

  // Roving-focus index for empty-state suggestions (keyboard nav).
  const [suggestionFocus, setSuggestionFocus] = useState(0);
  const suggestionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Motion-aware transitions: when reduced-motion is on we suppress
  // framer-motion enter animations entirely (no opacity/translate runs).
  const mFade = useMemo(
    () =>
      reducedMotion
        ? { initial: false as const, animate: { opacity: 1, y: 0 }, transition: { duration: 0 } }
        : {
            initial: { opacity: 0, y: 8 },
            animate: { opacity: 1, y: 0 },
            transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] as any },
          },
    [reducedMotion],
  );

  // Pending onboarding prompt: filled from workspaces.first_prompt on mount,
  // then consumed exactly once by the auto-send effect further below.
  const [pendingFirstPrompt, setPendingFirstPrompt] = useState<string | null>(null);
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  // True from the moment we consume the onboarding prompt until the resulting
  // send() promise settles. Drives the auto-send banner + composer lock so the
  // user sees a clear "kicking things off" state instead of an idle empty chat.
  const [autoSending, setAutoSending] = useState(false);
  // When the onboarding pipeline fails/times out even after auto-retries, we
  // surface a "Send again" button in the empty state and store the reason.
  const [autoSendError, setAutoSendError] = useState<string | null>(null);
  const [autoSendAttempt, setAutoSendAttempt] = useState(0);
  const autoSendPromptRef = useRef<string | null>(null);
  const AUTO_SEND_TIMEOUT_MS = 60_000;
  const AUTO_SEND_MAX_RETRIES = 2;
  const firstPromptFiredRef = useRef(false);
  // Per-workspace persistent lock so a remount / hot-reload / route bounce
  // can never re-fire the same onboarding prompt.
  const firstPromptLockKey = `raval:first-prompt-fired:${workspaceId}`;

  useEffect(() => {
    // Reset guards when the workspace changes so a new workspace can fire once.
    firstPromptFiredRef.current = false;
    setMessagesLoaded(false);
    setPendingFirstPrompt(null);
    setAutoSending(false);
    setAutoSendError(null);
    setAutoSendAttempt(0);
    autoSendPromptRef.current = null;

    supabase
      .from("chat_messages")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true })
      .limit(50)
      .then(({ data }) => {
        if (data) setMessages(data as any);
        setMessagesLoaded(true);
      });
    supabase
      .from("workspaces")
      .select("website_url, first_prompt")
      .eq("id", workspaceId)
      .maybeSingle()
      .then(({ data }) => {
        setSiteUrl(data?.website_url ?? null);
        const fp = (data as any)?.first_prompt?.trim?.() ?? "";
        // Only surface it if the persistent lock hasn't already been set.
        let locked = false;
        try {
          locked =
            typeof window !== "undefined" &&
            window.localStorage.getItem(firstPromptLockKey) === "1";
        } catch {
          /* noop */
        }
        if (fp && !locked) setPendingFirstPrompt(fp);
        else if (fp && locked) {
          // Stale flag left on the row — clear it so it won't be re-read later.
          void supabase.from("workspaces").update({ first_prompt: null }).eq("id", workspaceId);
        }
      });
    // Pull workspace activity so the chat can answer "what's pending / what did we publish" with real data.
    supabase
      .from("content_items")
      .select("title,status,channel,scheduled_at,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (!data) return;
        const pending = data.filter(
          (r: any) => r.status === "pending" || r.status === "needs_approval",
        ).length;
        const scheduled = data.filter((r: any) => r.status === "scheduled").length;
        const published = data.filter((r: any) => r.status === "published").length;
        const recentTitles = data
          .slice(0, 6)
          .map((r: any) => `${r.channel ?? "post"}: ${r.title ?? "(untitled)"} [${r.status}]`);
        setWsStats({ pending, scheduled, published, recentTitles });
      });
    // Coach briefing (cached in localStorage by MarketingCoachPanel).
    try {
      const raw = localStorage.getItem(`coach:briefing:v1:${workspaceId}`);
      if (raw) {
        const b = JSON.parse(raw);
        const bits: string[] = [];
        if (b?.focus?.title) bits.push(`Focus: ${b.focus.title}`);
        if (Array.isArray(b?.todaysMoves))
          bits.push(
            `Today: ${b.todaysMoves
              .slice(0, 3)
              .map((m: any) => m.title || m)
              .join(" · ")}`,
          );
        if (Array.isArray(b?.marketSignals))
          bits.push(
            `Market: ${b.marketSignals
              .slice(0, 2)
              .map((m: any) => m.title || m.signal || m)
              .join(" · ")}`,
          );
        if (bits.length) setCoachSummary(bits.join("\n"));
      }
    } catch {
      /* noop */
    }
    // Competitor alerts — recent unread.
    supabase
      .from("competitor_alerts")
      .select("kind,title,detail,detected_at,read_at")
      .eq("workspace_id", workspaceId)
      .order("detected_at", { ascending: false })
      .limit(6)
      .then(({ data }) => {
        if (!data?.length) return;
        const lines = data.map((a: any) => `- [${a.kind}] ${a.title}: ${a.detail ?? ""}`);
        setCompetitorSummary(lines.join("\n"));
      });
  }, [workspaceId, firstPromptLockKey]);

  useEffect(() => {
    messagesRef.current = messages;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Hero-suggested prompts prefill the composer; ⌘K dispatches chat:focus.
  useEffect(() => {
    const onPrefill = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail;
      let text: string | null = null;
      let focus = true;
      if (typeof detail === "string") text = detail;
      else if (detail && typeof detail === "object") {
        const d = detail as { text?: unknown; focus?: unknown };
        if (typeof d.text === "string") text = d.text;
        if (typeof d.focus === "boolean") focus = d.focus;
      }
      if (text !== null) {
        setInput(text);
        if (focus) textareaRef.current?.focus();
      }
    };
    const onFocus = () => textareaRef.current?.focus();
    window.addEventListener("chat:prefill", onPrefill as EventListener);
    window.addEventListener("chat:focus", onFocus);
    return () => {
      window.removeEventListener("chat:prefill", onPrefill as EventListener);
      window.removeEventListener("chat:focus", onFocus);
    };
  }, []);

  // Auto-focus textarea on mount and after streaming completes.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);
  useEffect(() => {
    if (!streaming) textareaRef.current?.focus();
  }, [streaming]);

  // Auto-grow the composer up to 5 lines, then scroll.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 24;
    const maxH = lineHeight * 5 + 20; // 5 lines + vertical padding
    const next = Math.min(ta.scrollHeight, maxH);
    ta.style.height = `${next}px`;
    ta.style.overflowY = ta.scrollHeight > maxH ? "auto" : "hidden";
  }, [input]);

  const summonAgent = (slug: string) => {
    const agent = agentList.find((a) => a.slug === slug);
    if (!agent || !isOn(agent.id)) return false;
    navigate({ to: `/app/${slug}` as any });
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("agent:deploy", { detail: { slug } }));
    }, 350);
    toast.success(`${agent.role} on it`, { description: agent.missions[0]?.label });
    return true;
  };

  // Compact brand context for the planner.
  const brandContext = (() => {
    const bits: string[] = [];
    if (dna.brandName) bits.push(`brand=${dna.brandName}`);
    if (dna.oneLiner) bits.push(`oneLiner=${dna.oneLiner}`);
    if (dna.voice) bits.push(`voice=${dna.voice}`);
    if (dna.audience) bits.push(`audience=${dna.audience}`);
    if (siteUrl) bits.push(`site=${siteUrl}`);
    return bits.join(" | ");
  })();

  // Structured context sources — selection happens per-turn based on the
  // last user message so we never send irrelevant blocks.
  const ctxSources = useMemo(() => {
    const sections: import("@/lib/ai/context-select").CtxSection[] = [];
    const push = (
      id: string,
      label: string,
      body: string,
      keywords: string[],
      opts: { baseScore?: number; maxChars?: number } = {},
    ) => {
      const trimmed = body.trim();
      if (!trimmed) return;
      sections.push({ id, label, body: trimmed, keywords, ...opts });
    };

    // Brand extended (only when the user asks about brand/positioning/etc.)
    const brandExtended: string[] = [];
    if (dna.about) brandExtended.push(`- About: ${dna.about}`);
    if (dna.industry) brandExtended.push(`- Industry: ${dna.industry}`);
    if (dna.businessModel) brandExtended.push(`- Business model: ${dna.businessModel}`);
    if (dna.uniqueValueProp) brandExtended.push(`- USP: ${dna.uniqueValueProp}`);
    if (dna.positioning) brandExtended.push(`- Positioning: ${dna.positioning}`);
    if (dna.mission) brandExtended.push(`- Mission: ${dna.mission}`);
    if (dna.values) brandExtended.push(`- Values: ${dna.values}`);
    push("brand-extended", "Brand context", brandExtended.join("\n"), [
      "brand",
      "positioning",
      "mission",
      "values",
      "story",
      "usp",
      "identity",
      "industry",
      "about",
    ]);

    // Products
    if (dna.products)
      push("products", "Products", dna.products, [
        "product",
        "products",
        "feature",
        "features",
        "offering",
        "service",
        "services",
        "pricing",
        "sku",
      ]);

    // Do / Don't rules — activate whenever the ask is about writing/tone
    const rules: string[] = [];
    if (dna.doRules) rules.push(`Do: ${dna.doRules}`);
    if (dna.dontRules) rules.push(`Don't: ${dna.dontRules}`);
    push(
      "rules",
      "Voice rules",
      rules.join("\n"),
      [
        "write",
        "post",
        "copy",
        "draft",
        "tone",
        "voice",
        "email",
        "caption",
        "headline",
        "hook",
        "cta",
      ],
      { baseScore: 1 },
    );

    // Visual identity
    const visual: string[] = [];
    if (dna.colors?.length)
      visual.push(
        `Colors: ${dna.colors
          .slice(0, 4)
          .map((c) => `${c.name} ${c.hex}`)
          .join(", ")}`,
      );
    if (dna.fonts?.length) visual.push(`Fonts: ${dna.fonts.slice(0, 3).join(", ")}`);
    push("visual", "Visual identity", visual.join("\n"), [
      "image",
      "logo",
      "color",
      "colors",
      "font",
      "fonts",
      "design",
      "visual",
      "brand kit",
      "palette",
      "typography",
    ]);

    // Persistent user insights — high value; keep baseScore so they always compete
    if (dna.userInsights?.length) {
      const body = dna.userInsights
        .slice(0, 10)
        .map((n) => `- ${n.title}: ${n.body}`)
        .join("\n");
      push(
        "insights",
        "Operator insights (respect these)",
        body,
        ["insight", "insights", "remember", "noted", "preference", "rule", "policy"],
        { baseScore: 2, maxChars: 800 },
      );
    }

    // Competitors
    if (dna.competitors?.length) {
      const body = dna.competitors
        .slice(0, 6)
        .map((c) => `- ${c.name}${c.positioning ? ` — ${c.positioning}` : ""}`)
        .join("\n");
      push("competitors", "Competitors", body, [
        "competitor",
        "competitors",
        "rival",
        "market",
        "landscape",
        "versus",
        "vs",
        "compare",
      ]);
    }

    // Customer signals
    const cs = dna.customer;
    if (cs && (cs.triggerSignals?.length || cs.objectionSignals?.length || cs.personas?.length)) {
      const parts: string[] = [];
      if (cs.personas?.length)
        parts.push(
          `Personas: ${cs.personas
            .slice(0, 4)
            .map((p) => p.name)
            .join(", ")}`,
        );
      if (cs.triggerSignals?.length)
        parts.push(
          `Triggers: ${cs.triggerSignals
            .slice(0, 4)
            .map((s) => s.text)
            .join(" | ")}`,
        );
      if (cs.objectionSignals?.length)
        parts.push(
          `Objections: ${cs.objectionSignals
            .slice(0, 4)
            .map((s) => s.text)
            .join(" | ")}`,
        );
      push("customer", "Customer signals", parts.join("\n"), [
        "customer",
        "persona",
        "audience",
        "buyer",
        "objection",
        "trigger",
        "pain",
        "icp",
        "segment",
      ]);
    }

    // Workspace activity
    if (
      wsStats &&
      (wsStats.pending || wsStats.scheduled || wsStats.published || wsStats.recentTitles.length)
    ) {
      const parts: string[] = [];
      if (wsStats.pending) parts.push(`Pending approvals: ${wsStats.pending}`);
      if (wsStats.scheduled) parts.push(`Scheduled: ${wsStats.scheduled}`);
      if (wsStats.published) parts.push(`Published recently: ${wsStats.published}`);
      if (wsStats.recentTitles.length)
        parts.push(`Recent: ${wsStats.recentTitles.slice(0, 4).join(" • ")}`);
      push("workspace", "Workspace activity", parts.join("\n"), [
        "approve",
        "approval",
        "schedule",
        "scheduled",
        "publish",
        "published",
        "calendar",
        "pending",
        "status",
        "queue",
        "recent",
      ]);
    }

    // Coach briefing
    if (coachSummary)
      push(
        "coach",
        "Coach briefing",
        coachSummary,
        ["coach", "strategy", "plan", "priority", "focus", "week", "goal", "brief"],
        { maxChars: 500 },
      );

    // Competitor alerts
    if (competitorSummary)
      push(
        "comp-alerts",
        "Competitor alerts",
        competitorSummary,
        ["alert", "alerts", "competitor", "change", "launched", "announced", "update"],
        { maxChars: 400 },
      );

    return {
      brandName: dna.brandName,
      oneLiner: dna.oneLiner,
      voice: dna.voice,
      audience: dna.audience,
      website: siteUrl || dna.websiteUrl || undefined,
      sections,
    } satisfies import("@/lib/ai/context-select").CtxSources;
  }, [dna, siteUrl, wsStats, coachSummary, competitorSummary]);

  // Flat context kept for downstream callers that expected a single string
  // (planner, agent-tasks, etc.). Uses a generic query so all sections score.
  const chatContext = useMemo(() => {
    return buildSmartChatContext("", ctxSources, 3000);
  }, [ctxSources]);

  const runChatStream = async (history: { role: string; content: string }[]) => {
    setStreaming(true);
    window.dispatchEvent(
      new CustomEvent("chat:working", { detail: { label: "Agents working on your site…" } }),
    );
    // Drive the rich preview stages from the latest user message.
    const lastUser = [...history].reverse().find((h) => h.role === "user")?.content ?? "";
    if (lastUser) {
      const plan = planFromPrompt(lastUser, { siteUrl, brand: dna.brandName });
      startPreviewPlan(plan);
    }
    try {
      const { buildSmartChatContext } = await import("@/lib/ai/context-select");
      const { compactHistory } = await import("@/lib/ai/history-compact");
      const smartCtx = buildSmartChatContext(lastUser, ctxSources, 2500);
      const compactMessages = compactHistory(
        history as import("@/lib/ai/history-compact").ChatTurn[],
      );

      const res = await authedFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: compactMessages, context: smartCtx }),
      });

      if (!res.ok || !res.body) {
        if (res.status === 429) toast.error("Rate limit hit. Wait a moment and try again.");
        else if (res.status === 402) toast.error("AI credits exhausted.");
        else toast.error("AI request failed");
        setStreaming(false);
        window.dispatchEvent(new CustomEvent("chat:idle"));
        stopPreviewPlan();
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";
      const aId = crypto.randomUUID();
      setMessages((m) => [...m, { id: aId, role: "assistant", kind: "text", content: "" }]);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n")) !== -1) {
          let line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") break;
          try {
            const parsed = JSON.parse(json);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              acc += delta;
              setMessages((m) => m.map((x) => (x.id === aId ? { ...x, content: acc } : x)));
            }
          } catch {
            buf = line + "\n" + buf;
            break;
          }
        }
      }
      recordTokens(Math.ceil(acc.length / 4));

      // Chat-first: parse any [[action:...]] tags out of the assistant message,
      // strip them from what we render, run them, and append a "what I did" chip row.
      try {
        const { parseToolCalls, executeToolCall } = await import("@/lib/chat-tools");
        const { calls, cleaned } = parseToolCalls(acc);
        if (cleaned !== acc) {
          setMessages((m) => m.map((x) => (x.id === aId ? { ...x, content: cleaned } : x)));
          acc = cleaned;
        }
        if (calls.length) {
          const saveMemory = async (title: string, body: string) => {
            const note = {
              id: crypto.randomUUID(),
              title,
              body,
              createdAt: Date.now(),
              source: "chat" as const,
            };
            const current = dnaRef.current;
            await saveDna({ userInsights: [...(current.userInsights ?? []), note] });
          };
          const results: Awaited<ReturnType<typeof executeToolCall>>[] = [];
          for (const c of calls) {
            const r = await executeToolCall(c, { workspaceId, saveMemory });
            results.push(r);
            if (r.ok) toast.success(r.label, r.detail ? { description: r.detail } : undefined);
            else toast.error(r.label, r.detail ? { description: r.detail } : undefined);
          }
          setMessages((m) => [
            ...m,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              kind: "actions",
              content: "",
              payload: { results },
            },
          ]);
        }
      } catch (e) {
        console.warn("tool parse failed", e);
      }

      await supabase
        .from("chat_messages")
        .insert({ workspace_id: workspaceId, role: "assistant", kind: "text", content: acc });
    } catch {
      toast.error("Connection lost");
      stopPreviewPlan();
    } finally {
      setStreaming(false);
      window.dispatchEvent(new CustomEvent("chat:idle"));
      completePreviewPlan("All done", "Your update is ready");
      // Background memory extraction — only if enough new turns since last sync.
      void maybeSyncMemory();
    }
  };

  const continueAfterClarify = async (
    clarifyMsgId: string,
    answers: Record<string, string[]>,
    payload: ClarifyPayload,
  ) => {
    // Render the answers summary into the clarify card and lock it.
    setMessages((m) =>
      m.map((x) =>
        x.id === clarifyMsgId
          ? { ...x, payload: { ...x.payload, done: true, submitted: answers } }
          : x,
      ),
    );
    setClarifying(false);

    const summaryLines = payload.questions
      .map((q) => {
        const vals = answers[q.id] ?? [];
        if (!vals.length) return null;
        return `- ${q.label}: ${vals.join(", ")}`;
      })
      .filter(Boolean);
    const userClarification = `My choices:\n${summaryLines.join("\n")}`;

    const synthetic: Msg = {
      id: crypto.randomUUID(),
      role: "user",
      kind: "text",
      content: userClarification,
    };
    setMessages((m) => [...m, synthetic]);
    await supabase
      .from("chat_messages")
      .insert({
        workspace_id: workspaceId,
        role: "user",
        kind: "text",
        content: userClarification,
      });

    // Rebuild history from current state + new turn.
    setTimeout(async () => {
      const history = [...messages, synthetic]
        .filter((m) => m.kind === "text")
        .slice(-14)
        .map((m) => ({ role: m.role, content: m.content }));
      await runChatStream(history);
    }, 50);
  };

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
    const hasAttachments = attachments.length > 0;
    if ((!text && !hasAttachments) || streaming || clarifying) return;
    if (attachments.some((a) => a.status === "reading")) {
      toast.message("Still reading attachments…");
      return;
    }

    // Compose the outgoing user content: attachment context first, then user text.
    const ctx = attachmentsToContext(attachments);
    const visibleText =
      text ||
      (hasAttachments
        ? `Please analyze the attached ${attachments.length === 1 ? "file" : "files"}.`
        : "");
    const attachSummary = hasAttachments
      ? `📎 ${attachments.length} file${attachments.length > 1 ? "s" : ""}: ${attachments.map((a) => a.name).join(", ")}`
      : "";
    const displayContent = [attachSummary, visibleText].filter(Boolean).join("\n\n");
    const wireContent = [ctx, visibleText].filter(Boolean).join("\n\n");

    const userMsg: Msg = {
      id: crypto.randomUUID(),
      role: "user",
      kind: "text",
      content: displayContent,
    };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setAttachments([]);

    recordTokens(Math.ceil(wireContent.length / 4));

    await supabase
      .from("chat_messages")
      .insert({ workspace_id: workspaceId, role: "user", kind: "text", content: displayContent });

    // Stash the wire content on the msg for history construction below.
    (userMsg as any)._wire = wireContent;

    // Detect quick-actions and append an action chip card before clarify/stream.
    const actions = detectChatActions(text);
    if (actions.length) {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          kind: "actions",
          content: "",
          payload: { actions },
        },
      ]);
    }

    // Lovable-style planner: ask clarifying questions first.
    setClarifying(true);
    let payload: ClarifyPayload | null = null;
    try {
      const cr = await authedFetch("/api/clarify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, brandContext }),
      });
      if (cr.ok) {
        const j = await cr.json();
        if (j?.needs_clarification && Array.isArray(j.questions) && j.questions.length) {
          payload = { rationale: j.rationale, questions: j.questions };
        }
      }
    } catch {}

    if (payload) {
      const cId = crypto.randomUUID();
      setMessages((m) => [
        ...m,
        {
          id: cId,
          role: "assistant",
          kind: "clarify",
          content: "",
          payload: { ...payload, done: false },
        },
      ]);
      // Wait for the user to submit/skip via ClarifyCard handlers.
      // setClarifying stays true until they act.
      return;
    }

    // Nothing to clarify — go straight to the stream.
    setClarifying(false);
    const history = [...messages, userMsg]
      .slice(-12)
      .map((m) => ({ role: m.role, content: (m as any)._wire || m.content }));
    await runChatStream(history);
  };

  // Run the onboarding prompt through send() with a timeout and detect whether
  // an assistant reply (or clarify card) actually landed. Returns true on
  // success so the caller can decide whether to retry.
  const runAutoSendOnce = async (prompt: string): Promise<boolean> => {
    const beforeAssistant = messagesRef.current.filter(
      (m) => m.role === "assistant" && (m.kind === "text" || m.kind === "clarify"),
    ).length;

    let timedOut = false;
    const timeoutP = new Promise<void>((resolve) => {
      window.setTimeout(() => {
        timedOut = true;
        resolve();
      }, AUTO_SEND_TIMEOUT_MS);
    });

    try {
      await Promise.race([send(prompt), timeoutP]);
    } catch {
      return false;
    }
    if (timedOut) return false;

    const afterAssistant = messagesRef.current.filter(
      (m) => m.role === "assistant" && (m.kind === "text" || m.kind === "clarify"),
    );
    if (afterAssistant.length <= beforeAssistant) return false;
    const last = afterAssistant[afterAssistant.length - 1];
    // Clarify card is a valid outcome (waiting on user). A text reply must be non-empty.
    if (last.kind === "clarify") return true;
    return typeof last.content === "string" && last.content.trim().length > 0;
  };

  // Drive the onboarding prompt with automatic retries + a manual fallback.
  const runAutoSendWithRetries = async (prompt: string) => {
    autoSendPromptRef.current = prompt;
    setAutoSendError(null);
    setAutoSending(true);
    let lastError: string | null = null;
    for (let attempt = 1; attempt <= AUTO_SEND_MAX_RETRIES + 1; attempt++) {
      setAutoSendAttempt(attempt);
      try {
        const ok = await runAutoSendOnce(prompt);
        if (ok) {
          setAutoSending(false);
          setAutoSendError(null);
          return;
        }
        lastError = "The request didn't complete in time.";
      } catch (e: any) {
        lastError = e?.message ?? "Something went wrong sending your first prompt.";
      }
      if (attempt <= AUTO_SEND_MAX_RETRIES) {
        // Exponential backoff: 1.2s, 2.4s
        const delay = 1200 * attempt;
        toast.message(`Retrying your first prompt… (attempt ${attempt + 1})`);
        await new Promise((r) => window.setTimeout(r, delay));
        // Remove any half-written empty assistant bubble from the failed attempt
        // so the retry starts from a clean tail.
        setMessages((m) => {
          const idx = [...m]
            .reverse()
            .findIndex((x) => x.role === "assistant" && x.kind === "text" && !x.content?.trim());
          if (idx === -1) return m;
          const realIdx = m.length - 1 - idx;
          return m.slice(0, realIdx).concat(m.slice(realIdx + 1));
        });
      }
    }
    setAutoSending(false);
    setAutoSendError(lastError ?? "Send failed. You can try again below.");
    toast.error("Couldn't send onboarding prompt", { description: "Tap Send again to retry." });
  };

  const resendOnboardingPrompt = () => {
    const prompt = autoSendPromptRef.current;
    if (!prompt || autoSending || streaming || clarifying) return;
    void runAutoSendWithRetries(prompt);
  };

  // Auto-run the onboarding first prompt through the real chat pipeline
  // (clarify → stream → assistant reply). Guarded so it only fires when:
  //   1. initial messages have loaded,
  //   2. the chat is truly empty (no prior messages of any kind),
  //   3. we haven't already fired this workspace's prompt in this tab, and
  //   4. the persistent per-workspace lock in localStorage is not set.
  useEffect(() => {
    if (!pendingFirstPrompt || firstPromptFiredRef.current) return;
    if (!messagesLoaded) return;
    if (messages.length > 0) {
      // Chat already has content — treat the flag as consumed and clear it so
      // it can never re-fire on a later remount.
      firstPromptFiredRef.current = true;
      try {
        window.localStorage.setItem(firstPromptLockKey, "1");
      } catch {
        /* noop */
      }
      void supabase.from("workspaces").update({ first_prompt: null }).eq("id", workspaceId);
      setPendingFirstPrompt(null);
      return;
    }
    if (streaming || clarifying) return;

    firstPromptFiredRef.current = true;
    try {
      window.localStorage.setItem(firstPromptLockKey, "1");
    } catch {
      /* noop */
    }

    // Clear the flag on the workspace so a refresh from another tab doesn't re-fire it.
    void supabase.from("workspaces").update({ first_prompt: null }).eq("id", workspaceId);

    const prompt = pendingFirstPrompt;
    setPendingFirstPrompt(null);
    // Fire on a microtask so the state updates above commit first.
    void Promise.resolve().then(() => {
      void runAutoSendWithRetries(prompt);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pendingFirstPrompt,
    messagesLoaded,
    messages.length,
    workspaceId,
    streaming,
    clarifying,
    firstPromptLockKey,
  ]);

  const empty = messages.length === 0;

  const centered = variant === "centered";

  return (
    <div
      className={
        centered
          ? "flex h-full flex-col bg-transparent"
          : "flex h-full flex-col bg-gradient-to-b from-background via-background to-background/60"
      }
    >
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-auto scrollbar-thin">
        <div className={centered ? "mx-auto w-full max-w-2xl" : ""}>
          {autoSending && empty ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <motion.div
                initial={reducedMotion ? false : { scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={
                  reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 200, damping: 20 }
                }
                className="relative mb-5"
                aria-live="polite"
                aria-busy="true"
              >
                <span
                  className="absolute -inset-8 -z-10 rounded-full blur-3xl opacity-60 animate-pulse"
                  style={{
                    background:
                      "radial-gradient(50% 50% at 50% 50%, hsl(var(--brand-green) / 0.35), transparent 70%)",
                  }}
                  aria-hidden
                />
                <div className="relative grid h-14 w-14 place-items-center rounded-2xl border border-border/70 bg-card/70 backdrop-blur">
                  <Loader2
                    className="h-6 w-6 animate-spin text-[hsl(var(--brand-green))]"
                    aria-hidden
                  />
                </div>
              </motion.div>
              <h2 className="text-[18px] font-semibold tracking-tight text-foreground">
                {autoSendAttempt > 1
                  ? `Retrying your first request… (attempt ${autoSendAttempt})`
                  : "Kicking off your first request…"}
              </h2>
              <p className="mt-2 max-w-xs text-[13px] leading-relaxed text-muted-foreground">
                Raval AI is reading your brand context and preparing an answer. This takes a few
                seconds.
              </p>
              <div className="mt-5 flex items-center gap-1.5" aria-hidden>
                <span
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-[hsl(var(--brand-green))]"
                  style={{ animationDelay: "0ms" }}
                />
                <span
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-[hsl(var(--brand-green))]"
                  style={{ animationDelay: "150ms" }}
                />
                <span
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-[hsl(var(--brand-green))]"
                  style={{ animationDelay: "300ms" }}
                />
              </div>
            </div>
          ) : autoSendError && empty && autoSendPromptRef.current ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <div className="relative mb-5 grid h-14 w-14 place-items-center rounded-2xl border border-amber-500/40 bg-amber-500/10">
                <AlertTriangle className="h-6 w-6 text-amber-500" aria-hidden />
              </div>
              <h2 className="text-[18px] font-semibold tracking-tight text-foreground">
                We couldn't send your first prompt
              </h2>
              <p className="mt-2 max-w-xs text-[13px] leading-relaxed text-muted-foreground">
                {autoSendError} We already retried automatically a couple of times.
              </p>
              <div className="mt-2 max-w-xs rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-left text-[12px] text-muted-foreground">
                <span className="font-medium text-foreground">Your prompt:</span>{" "}
                {autoSendPromptRef.current}
              </div>
              <button
                onClick={resendOnboardingPrompt}
                disabled={autoSending || streaming || clarifying}
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-[13px] font-medium text-background transition hover:opacity-90 active:scale-95 disabled:opacity-50"
              >
                <ArrowUp className="h-3.5 w-3.5 rotate-45" aria-hidden />
                Send again
              </button>
            </div>
          ) : empty ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <motion.div
                initial={reducedMotion ? false : { scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={
                  reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 200, damping: 20 }
                }
                className="relative mb-5"
              >
                <span
                  className="absolute -inset-6 -z-10 rounded-full blur-3xl opacity-40"
                  style={{
                    background:
                      "radial-gradient(50% 50% at 50% 50%, hsl(var(--foreground) / 0.08), transparent 70%)",
                  }}
                  aria-hidden
                />
                <div className="relative grid place-items-center rounded-2xl">
                  <Logo height={36} markOnly />
                </div>
              </motion.div>
              <h2 className="text-[20px] font-semibold tracking-tight text-foreground">
                How can I help you grow?
              </h2>
              <p className="mt-2 max-w-xs text-[13px] leading-relaxed text-muted-foreground">
                Ask anything about your site — SEO, content, social, ads. Work shows up live on the
                right.
              </p>
              <div
                className="mt-6 grid w-full max-w-sm gap-1.5"
                role="listbox"
                aria-label="Prompt suggestions — use arrow keys to browse, Enter to send"
                data-suggestion-list
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown" || e.key === "ArrowRight") {
                    e.preventDefault();
                    const next = (suggestionFocus + 1) % SUGGESTIONS.length;
                    setSuggestionFocus(next);
                    suggestionRefs.current[next]?.focus();
                  } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
                    e.preventDefault();
                    const next = (suggestionFocus - 1 + SUGGESTIONS.length) % SUGGESTIONS.length;
                    setSuggestionFocus(next);
                    suggestionRefs.current[next]?.focus();
                  } else if (e.key === "Home") {
                    e.preventDefault();
                    setSuggestionFocus(0);
                    suggestionRefs.current[0]?.focus();
                  } else if (e.key === "End") {
                    e.preventDefault();
                    const last = SUGGESTIONS.length - 1;
                    setSuggestionFocus(last);
                    suggestionRefs.current[last]?.focus();
                  }
                }}
              >
                {SUGGESTIONS.map((s, i) => {
                  const Icon = s.icon;
                  const isActive = i === suggestionFocus;
                  return (
                    <motion.button
                      key={s.label}
                      ref={(el) => {
                        suggestionRefs.current[i] = el;
                      }}
                      initial={reducedMotion ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={reducedMotion ? { duration: 0 } : { delay: 0.08 + i * 0.05 }}
                      onClick={() => send(s.label)}
                      onFocus={() => setSuggestionFocus(i)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          send(s.label);
                        }
                      }}
                      role="option"
                      aria-selected={isActive}
                      tabIndex={isActive ? 0 : -1}
                      data-suggestion
                      aria-label={`${s.label}. ${s.hint}`}
                      className="chat-focus group flex items-center gap-3 rounded-xl border border-border/60 bg-card/60 px-3 py-2.5 text-left backdrop-blur transition-all hover:-translate-y-0.5 hover:border-foreground/25 hover:bg-card hover:shadow-[0_8px_24px_-14px_hsl(0_0%_0%/0.5)] focus-visible:border-foreground/35 aria-selected:border-foreground/30"
                    >
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-secondary/70 text-muted-foreground transition group-hover:bg-secondary group-hover:text-foreground">
                        <Icon className="h-3.5 w-3.5" strokeWidth={1.85} aria-hidden />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block truncate font-sans text-[12.5px] font-medium text-foreground">
                          {s.label}
                        </span>
                        <span className="block truncate font-sans text-[11px] text-muted-foreground">
                          {s.hint}
                        </span>
                      </span>
                      <ArrowUp
                        className="h-3 w-3 rotate-45 text-muted-foreground opacity-0 transition group-hover:opacity-100"
                        aria-hidden
                      />
                    </motion.button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-5 px-4 py-5 md:space-y-6 md:px-5 md:py-6">
              <AnimatePresence initial={false}>
                {messages.map((m, i) => {
                  if (m.kind === "clarify" && m.payload) {
                    return (
                      <motion.div
                        key={m.id}
                        layout={!reducedMotion}
                        initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reducedMotion ? { opacity: 1 } : { opacity: 0 }}
                        transition={{ duration: reducedMotion ? 0 : 0.25 }}
                        className="flex gap-3"
                      >
                        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-card">
                          <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                        <ClarifyCard
                          payload={m.payload}
                          done={!!m.payload.done}
                          submittedAnswers={m.payload.submitted}
                          onSubmit={(answers) => continueAfterClarify(m.id, answers, m.payload)}
                          onSkip={() => {
                            setMessages((arr) =>
                              arr.map((x) =>
                                x.id === m.id
                                  ? { ...x, payload: { ...x.payload, done: true, submitted: {} } }
                                  : x,
                              ),
                            );
                            setClarifying(false);
                            const history = [...messages]
                              .filter((x) => x.kind === "text")
                              .slice(-12)
                              .map((x) => ({ role: x.role, content: x.content }));
                            runChatStream(history);
                          }}
                        />
                      </motion.div>
                    );
                  }
                  if (m.kind === "actions" && (m.payload?.actions || m.payload?.results)) {
                    return (
                      <motion.div
                        key={m.id}
                        layout={!reducedMotion}
                        initial={reducedMotion ? false : { opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reducedMotion ? { opacity: 1 } : { opacity: 0 }}
                        transition={{ duration: reducedMotion ? 0 : 0.2 }}
                      >
                        {m.payload?.results ? <ToolResultsRow results={m.payload.results} /> : null}
                        {m.payload?.actions ? <ActionChips actions={m.payload.actions} /> : null}
                      </motion.div>
                    );
                  }

                  return (
                    <motion.div
                      key={m.id}
                      layout={!reducedMotion}
                      {...mFade}
                      className={`flex ${m.role === "user" ? "justify-end" : "flex-col gap-2"}`}
                    >
                      {m.role !== "user" ? (
                        <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          <div className="flex h-6 w-6 items-center justify-center rounded-lg border border-border/60 bg-card">
                            <Sparkles className="h-3 w-3 text-muted-foreground" />
                          </div>
                          <span>Raval Ai</span>
                        </div>
                      ) : null}
                      <div
                        className={
                          m.role === "user"
                            ? "chat-bubble-user"
                            : "px-0.5 text-[14px] leading-[1.7] text-foreground"
                        }
                      >
                        <ChatMessageContent content={m.content} role={m.role} />
                        {streaming && m.role === "assistant" && i === messages.length - 1 && (
                          <span className="caret-blink" data-chat-shimmer aria-hidden />
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              {clarifying && !messages.some((m) => m.kind === "clarify" && !m.payload?.done) && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="ml-10 flex items-center gap-2 text-[11.5px]"
                >
                  <span className="composer-pulse-dot" aria-hidden />
                  <span className="composer-shimmer-text font-medium">Reading your prompt…</span>
                </motion.div>
              )}
              {streaming &&
                (messages[messages.length - 1]?.role !== "assistant" ||
                  !messages[messages.length - 1]?.content) && <ThinkingTrail site={siteUrl} />}
              {!streaming &&
                messages.length > 0 &&
                messages[messages.length - 1]?.role === "assistant" &&
                messages[messages.length - 1]?.content && (
                  <NextStepSuggestions
                    lastUserMessage={
                      [...messages].reverse().find((m) => m.role === "user")?.content
                    }
                    onPick={(p) => send(p)}
                    workspaceId={workspaceId}
                    brandContext={chatContext}
                  />
                )}
            </div>
          )}
        </div>
      </div>

      {/* Composer — Lovable-style pill */}
      <div
        className={
          centered
            ? `shrink-0 px-3 pb-[max(0.875rem,env(safe-area-inset-bottom))] ${mobileAccessory ? "pt-1" : "pt-3"} md:px-4`
            : "shrink-0 px-3 pb-[max(0.875rem,env(safe-area-inset-bottom))] pt-3 md:px-4"
        }
      >
        {mobileAccessory && <div className="mx-auto mb-2 w-full max-w-2xl">{mobileAccessory}</div>}
        <div
          className={`${centered ? "mx-auto w-full max-w-2xl" : ""} relative`}
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <div
            className={`prompt-pill px-2.5 py-2 transition ${dragging ? "ring-2 ring-primary/60 ring-offset-2 ring-offset-background" : ""}`}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) void addFiles(e.target.files);
                e.currentTarget.value = "";
              }}
            />

            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5 px-2 pt-1">
                {attachments.map((a) => {
                  const Icon =
                    a.kind === "image"
                      ? FileImage
                      : a.kind === "xlsx"
                        ? FileSpreadsheet
                        : a.kind === "pdf" || a.kind === "docx" || a.kind === "text"
                          ? FileText
                          : FileIcon;
                  const tint =
                    a.kind === "image"
                      ? "text-fuchsia-400"
                      : a.kind === "xlsx"
                        ? "text-emerald-400"
                        : a.kind === "pdf"
                          ? "text-rose-400"
                          : a.kind === "docx"
                            ? "text-sky-400"
                            : "text-muted-foreground";
                  return (
                    <div
                      key={a.id}
                      className={`group relative flex items-center gap-2 rounded-lg border pl-1 pr-1.5 py-1 text-[11.5px] ${
                        a.status === "error"
                          ? "border-destructive/50 bg-destructive/10"
                          : "border-border/70 bg-card"
                      }`}
                      title={a.status === "error" ? a.error : `${a.name} · ${niceSize(a.size)}`}
                    >
                      {a.preview ? (
                        <img src={a.preview} alt="" className="h-7 w-7 rounded-md object-cover" />
                      ) : (
                        <span
                          className={`grid h-7 w-7 place-items-center rounded-md bg-secondary ${tint}`}
                        >
                          {a.status === "reading" ? (
                            <span className="composer-skel-chip h-4 w-4" aria-hidden />
                          ) : (
                            <Icon className="h-3.5 w-3.5" />
                          )}
                        </span>
                      )}
                      <div className="flex min-w-0 flex-col leading-tight">
                        <span className="max-w-[160px] truncate font-medium text-foreground">
                          {a.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {a.status === "reading"
                            ? "Reading…"
                            : a.status === "error"
                              ? "Failed"
                              : `${a.kind.toUpperCase()} · ${niceSize(a.size)}`}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeAttachment(a.id)}
                        aria-label={`Remove ${a.name}`}
                        className="ml-1 grid h-5 w-5 place-items-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={autoSending}
                className="prompt-chip chat-focus shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                data-icon-only="true"
                aria-label="Attach file"
                title="Attach files — PDF, DOCX, XLSX, images, code, text (max 20MB each)"
              >
                <Mi name="add" size={22} weight="medium" />
              </button>

              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  // Enter sends. Shift+Enter (and Ctrl/Cmd+Enter) insert a newline
                  // so multi-line prompts stay easy to compose. IME composition
                  // (Japanese/Chinese/Korean input) is respected — never intercept
                  // Enter while the user is confirming a candidate.
                  const composing =
                    (e.nativeEvent as KeyboardEvent).isComposing || e.keyCode === 229;
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.ctrlKey &&
                    !e.metaKey &&
                    !e.altKey &&
                    !composing
                  ) {
                    e.preventDefault();
                    if (!autoSending) send();
                  }
                }}
                onPaste={onPaste}
                placeholder={
                  autoSending
                    ? "Sending your onboarding prompt…"
                    : attachments.length
                      ? "Add a question about the file(s)…"
                      : "Ask Raval AI"
                }
                rows={1}
                disabled={autoSending}
                aria-busy={autoSending}
                aria-keyshortcuts="Enter Shift+Enter"
                title="Enter to send · Shift+Enter for new line"
                className="flex-1 resize-none bg-transparent px-2 py-2 text-[16px] leading-6 outline-none placeholder:text-muted-foreground placeholder:font-normal disabled:cursor-not-allowed disabled:opacity-60 min-h-[40px] self-center"
              />

              <button
                onClick={() => {
                  if (!autoSending) send();
                }}
                disabled={autoSending || (!input.trim() && !attachments.length && !streaming)}
                aria-label={
                  autoSending
                    ? "Sending onboarding prompt"
                    : streaming
                      ? "Stop generating"
                      : "Send message"
                }
                aria-busy={autoSending}
                data-loading={autoSending ? "true" : undefined}
                className="prompt-send chat-focus shrink-0"
              >
                {autoSending ? (
                  <Mi name="progress_activity" size={20} weight="bold" aria-hidden />
                ) : streaming ? (
                  <Mi name="stop" size={20} weight="bold" filled />
                ) : (
                  <Mi name="arrow_upward" size={22} weight="bold" />
                )}
              </button>
            </div>

            {autoSending && (
              <div
                className="mx-2 mt-2 flex items-center gap-2.5 rounded-full border border-border/50 bg-card/50 px-3 py-1.5"
                role="status"
                aria-live="polite"
              >
                <span className="composer-pulse-dot" aria-hidden />
                <span className="composer-shimmer-text text-[11.5px] font-medium">
                  Sending your first prompt to Raval AI…
                </span>
                <span className="composer-skel ml-auto h-1.5 w-24" aria-hidden />
              </div>
            )}
          </div>
          {dragging && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/60 bg-primary/10 backdrop-blur-sm">
              <div className="flex items-center gap-2 rounded-full bg-background/90 px-4 py-1.5 text-[12px] font-medium text-foreground shadow-lg">
                <Paperclip className="h-3.5 w-3.5" />
                Drop to attach · PDF · DOCX · XLSX · images · code
              </div>
            </div>
          )}
        </div>
        <p className="mt-1.5 flex items-center justify-center gap-1 text-center text-[10.5px] leading-none text-muted-foreground/60">
          <span>{model.label}</span>
          <span aria-hidden>·</span>
          <span>Enter to send</span>
        </p>
      </div>
    </div>
  );
}
