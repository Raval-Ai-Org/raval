"use client";

// The Mellox chat. Layout: a centered greeting with the message box in the
// middle of the page for a new chat; once a message is sent the box glides to
// the bottom and the conversation fills the space above it.
//
// Control model — nothing opens over the conversation by itself:
//   - "Make me a …" requests (chat-intent.ts) start in the Studio side panel at
//     once and show a live progress card here.
//   - Anything else the reply offers to open is a button under that reply.
//   - Changes to data (memory, drafts, audits) wait for approval.
import { addAppEventListener, emitAppEvent, removeAppEventListener } from "@/lib/app-events";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { authedFetch } from "@/lib/authed-fetch";
import { useNavigate } from "@/lib/navigation";
import { conversationPath, workspacePath } from "@/lib/workspace/paths";
import { ArrowDown } from "@/components/icons";
import { toast } from "sonner";
import {
  classify as classifyAttachment,
  extractAttachment,
  attachmentsToContext,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  type Attachment,
} from "@/lib/file-extract";
import { recordTokens } from "@/hooks/use-agent-toggles";
import { NextStepSuggestions } from "@/components/app/NextStepSuggestions";
import { ClarifyCard, type ClarifyPayload } from "@/components/app/ClarifyCard";
import { useBrandDna } from "@/hooks/use-brand-dna";
import { buildSmartChatContext } from "@/lib/ai/context-select";
import { useChatPrefs } from "@/hooks/use-chat-prefs";
import {
  startPreviewPlan,
  completePreviewPlan,
  stopPreviewPlan,
  planFromPrompt,
} from "@/lib/preview-stages";
import { detectChatActions, type ChatAction } from "@/lib/chat-actions";
import type { ChatToolCall, ChatToolResult } from "@/lib/chat-tools";
import { SuggestedActions } from "@/components/app/SuggestedActions";
import { detectCreateIntent } from "@/lib/chat-intent";
import { STUDIO_FORMATS } from "@/lib/studio/formats";
import {
  getStudioState,
  startInBackground,
  subscribe as subscribeStudio,
} from "@/lib/studio/session-store";
import { cn } from "@/lib/utils";
import { ChatComposer, CHAT_MODELS, type ChatComposerHandle } from "./chat/ChatComposer";
import { ChatGreeting, ChatStarters, type Starter } from "./chat/ChatEmptyState";
import { AssistantMessage, ErrorMessage, NoticeMessage, UserMessage } from "./chat/ChatMessages";
import { ChatOffers } from "./chat/ChatOffers";
import { StudioTaskCard, type StudioTaskPayload } from "./chat/StudioTaskCard";
import { ThinkingIndicator } from "./chat/ThinkingIndicator";

type MsgKind = "text" | "clarify" | "actions" | "notice" | "error" | "studio";

type Msg = {
  id: string;
  role: "user" | "assistant" | "system";
  kind: MsgKind;
  content: string;
  status?: "sending" | "streaming" | "completed" | "failed" | "cancelled";
  payload?: any;
  /** Created in this session (animates in); history rows appear without motion. */
  live?: boolean;
};

type ActionsPayload = {
  offers?: ChatToolCall[];
  suggestions?: ChatToolCall[];
  actions?: ChatAction[];
};

/** Stored rows → messages. Studio cards are stored as kind "progress" with payload.studio. */
function fromRow(row: any): Msg | null {
  if (row.kind === "progress" && row.payload?.studio) {
    return {
      id: row.id,
      role: "assistant",
      kind: "studio",
      content: "",
      payload: row.payload.studio,
    };
  }
  if (row.kind !== "text") return null;
  return { id: row.id, role: row.role, kind: "text", content: row.content ?? "" };
}

function isDesktop() {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
}

/** Resolves with the job id once the session's create request returns (or null after a wait). */
function waitForJobId(sessionId: string, timeoutMs = 12_000): Promise<string | null> {
  return new Promise((resolve) => {
    const read = () => {
      const s = getStudioState().sessions.find((x) => x.id === sessionId);
      if (!s) return { done: true, id: null };
      if (s.job?.id) return { done: true, id: s.job.id };
      if (!s.pendingKey && s.error) return { done: true, id: null };
      return { done: false, id: null };
    };
    const first = read();
    if (first.done) return resolve(first.id);
    let unsub: () => void = () => {};
    const timer = window.setTimeout(() => {
      unsub();
      resolve(null);
    }, timeoutMs);
    unsub = subscribeStudio(() => {
      const r = read();
      if (r.done) {
        window.clearTimeout(timer);
        unsub();
        resolve(r.id);
      }
    }) as () => void;
  });
}

export function ChatPanel({
  workspaceId,
  conversationId = null,
  mobileAccessory,
}: {
  workspaceId: string;
  conversationId?: string | null;
  /** Kept for callers; the chat always uses the centered layout. */
  variant?: "rail" | "centered";
  mobileAccessory?: ReactNode;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [failedTurn, setFailedTurn] = useState<{ role: string; content: string }[] | null>(null);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);
  // Leaving this workspace (the panel is keyed by it) cancels its in-flight reply.
  useEffect(() => () => abortRef.current?.abort(), []);
  const [clarifying, setClarifying] = useState(false);
  const [modelId, setModelId] = useState(CHAT_MODELS[0].id);
  const [siteUrl, setSiteUrl] = useState<string | null>(null);
  const [wsStats, setWsStats] = useState<{
    pending: number;
    scheduled: number;
    published: number;
    recentTitles: string[];
  } | null>(null);
  const [coachSummary, setCoachSummary] = useState<string | null>(null);
  const [competitorSummary, setCompetitorSummary] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ChatComposerHandle>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const nearBottomRef = useRef(true);

  // Model choice is remembered per browser.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("chat:model");
      if (saved && CHAT_MODELS.some((m) => m.id === saved)) setModelId(saved);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const changeModel = (id: string) => {
    setModelId(id);
    try {
      localStorage.setItem("chat:model", id);
    } catch {
      /* storage unavailable */
    }
  };

  const scrollToLatest = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior });
    nearBottomRef.current = true;
    setShowJumpToLatest(false);
  }, []);

  const addFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    const currentTotal = attachments.reduce((s, a) => s + a.size, 0);
    let running = currentTotal;
    const staged: Attachment[] = [];
    for (const f of files) {
      if (f.size > MAX_FILE_BYTES) {
        toast.error(`${f.name} is too big`, {
          description: `Files can be up to ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)} MB.`,
        });
        continue;
      }
      if (running + f.size > MAX_TOTAL_BYTES) {
        toast.error("Too many files", { description: "Remove some files and try again." });
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
        toast.error(`Couldn't read ${att.name}`, { description: e?.message });
      }
    }
  };

  const removeAttachment = (id: string) =>
    setAttachments((prev) => prev.filter((a) => a.id !== id));

  const navigate = useNavigate();
  const conversationRef = useRef<string | null>(conversationId);
  const preserveMessagesOnRouteRef = useRef(false);
  const skipNextHistoryLoadRef = useRef(false);
  const { dna, save: saveDna } = useBrandDna(workspaceId);
  const dnaRef = useRef(dna);
  // Used by an APPROVED "save to memory" suggestion from a chat reply.
  const saveMemoryNote = async (title: string, body: string) => {
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
  const messagesRef = useRef<Msg[]>([]);
  useEffect(() => {
    dnaRef.current = dna;
  }, [dna]);
  const syncingMemoryRef = useRef(false);
  // Live message count at this session's last sync. The stored count is the DB
  // window (at most 60), which a long conversation outgrows — it then fired an
  // extraction on every turn.
  const lastSyncedLiveCountRef = useRef<number | null>(null);
  const maybeSyncMemory = async () => {
    if (syncingMemoryRef.current) return;
    const current = dnaRef.current;
    const liveCount = messagesRef.current.length;
    const lastRaw = lastSyncedLiveCountRef.current ?? current.memoryLastMsgCount ?? 0;
    // A shorter live list means a different conversation: count from zero.
    const last = liveCount < lastRaw ? 0 : lastRaw;
    if (liveCount < 4) return;
    if (liveCount - last < 4) return;
    syncingMemoryRef.current = true;
    try {
      const { syncMemoryFromChat } = await import("@/lib/memory-sync");
      const res = await syncMemoryFromChat(workspaceId, current, saveDna, conversationRef.current);
      lastSyncedLiveCountRef.current = liveCount;
      if (res.added > 0) {
        toast.success(
          `Remembered ${res.added} new thing${res.added > 1 ? "s" : ""} about your brand`,
        );
      }
    } catch (e) {
      console.warn("memory sync failed", e);
    } finally {
      syncingMemoryRef.current = false;
    }
  };

  const { reducedMotion } = useChatPrefs();

  useEffect(() => {
    conversationRef.current = conversationId;
    if (preserveMessagesOnRouteRef.current) preserveMessagesOnRouteRef.current = false;
    else setMessages([]);
    setInput("");
  }, [conversationId]);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
      const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
      const name = [meta.full_name, meta.name, meta.first_name].find(
        (v): v is string => typeof v === "string" && v.trim().length > 0,
      );
      setUserName(name ?? null);
    });
  }, []);

  const titleFromPrompt = (prompt: string) => {
    const clean = prompt
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[.!?]+$/, "");
    if (!clean) return "New chat";
    const words = clean.split(" ").slice(0, 8);
    const title = words.join(" ");
    return title.length > 58 ? `${title.slice(0, 55).trimEnd()}...` : title;
  };

  const ensureConversation = async (firstPrompt?: string) => {
    if (conversationRef.current) return conversationRef.current;
    const { data, error } = await supabase
      .from("conversations")
      .insert({
        workspace_id: workspaceId,
        title: firstPrompt ? titleFromPrompt(firstPrompt) : "New chat",
      })
      .select("id")
      .single();
    if (error || !data?.id) {
      console.error("conversation creation failed", {
        code: error?.code,
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
      });
      if (error?.code === "PGRST205" || error?.code === "42P01") {
        throw new Error("Chat storage is not initialized. Apply the latest Supabase migration.");
      }
      throw new Error(error?.message || "Could not start a conversation");
    }
    conversationRef.current = data.id;
    preserveMessagesOnRouteRef.current = true;
    skipNextHistoryLoadRef.current = true;
    navigate({ to: conversationPath(workspaceId, data.id), replace: true });
    emitAppEvent("chat:conversation-changed");
    return data.id;
  };

  useEffect(() => {
    let cancelled = false;
    if (conversationId) {
      if (skipNextHistoryLoadRef.current) {
        skipNextHistoryLoadRef.current = false;
      } else {
        setHistoryLoading(true);
        void (async () => {
          // A conversation only opens inside its own workspace. A link to another
          // workspace's (or a deleted) conversation must not be reused — new
          // messages would otherwise attach to it under this workspace.
          const { data: owned } = await supabase
            .from("conversations")
            .select("id")
            .eq("id", conversationId)
            .eq("workspace_id", workspaceId)
            .maybeSingle();
          if (cancelled) return;
          if (!owned) {
            setHistoryLoading(false);
            if (conversationRef.current === conversationId) conversationRef.current = null;
            toast.error("That conversation isn't in this workspace");
            navigate({ to: workspacePath(workspaceId), replace: true });
            return;
          }
          const { data } = await supabase
            .from("chat_messages")
            .select("*")
            .eq("workspace_id", workspaceId)
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: true })
            .limit(100);
          if (cancelled || conversationRef.current !== conversationId) return;
          setHistoryLoading(false);
          if (data) {
            const rows = data.map(fromRow).filter((m): m is Msg => m !== null);
            setMessages((current) => (current.length === 0 ? rows : current));
            requestAnimationFrame(() => scrollToLatest("auto"));
          }
        })();
      }
    }
    supabase
      .from("workspaces")
      .select("website_url")
      .eq("id", workspaceId)
      .maybeSingle()
      .then(({ data }) => {
        setSiteUrl(data?.website_url ?? null);
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
    return () => {
      cancelled = true;
    };
  }, [workspaceId, conversationId]);

  /* ───────────── scrolling: stay with the reply while it's written ───────────── */

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const onChatScroll = () => {
    const c = scrollRef.current;
    if (!c) return;
    const near = c.scrollHeight - c.scrollTop - c.clientHeight < 140;
    nearBottomRef.current = near;
    setShowJumpToLatest(!near && messagesRef.current.length > 0);
  };

  const showingConversation = messages.length > 0 || historyLoading;
  // Text reveals smoothly after state updates, so follow the content's size,
  // not just the message list.
  useEffect(() => {
    const el = contentRef.current;
    const c = scrollRef.current;
    if (!el || !c || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (nearBottomRef.current) c.scrollTop = c.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [showingConversation]);

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
        if (focus) composerRef.current?.focus();
      }
    };
    const onFocus = () => composerRef.current?.focus();
    // A prompt handed over from Command Center for THIS workspace only.
    try {
      const key = `chat:prefill:${workspaceId}`;
      const handed = sessionStorage.getItem(key);
      if (handed) {
        sessionStorage.removeItem(key);
        setInput(handed);
      }
    } catch {
      /* storage unavailable */
    }
    addAppEventListener("chat:prefill", onPrefill);
    addAppEventListener("chat:focus", onFocus);
    return () => {
      removeAppEventListener("chat:prefill", onPrefill);
      removeAppEventListener("chat:focus", onFocus);
    };
  }, [workspaceId]);

  useEffect(() => {
    composerRef.current?.focus();
  }, []);
  useEffect(() => {
    if (!streaming) composerRef.current?.focus();
  }, [streaming]);

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

  /* ───────────── Studio: start work from the chat ───────────── */

  const persistStudioCard = async (msg: Msg, conversation: string) => {
    const task = msg.payload as StudioTaskPayload;
    const jobId = task.sessionId ? await waitForJobId(task.sessionId) : null;
    await supabase.from("chat_messages").insert({
      id: msg.id,
      workspace_id: task.workspaceId,
      conversation_id: conversation,
      user_id: userId,
      role: "assistant",
      kind: "progress",
      content: `Studio: ${STUDIO_FORMATS[task.type]?.label ?? task.type}`,
      payload: { studio: { ...task, jobId } },
      status: "completed",
    });
    if (jobId) {
      setMessages((m) =>
        m.map((x) => (x.id === msg.id ? { ...x, payload: { ...x.payload, jobId } } : x)),
      );
    }
  };

  const addStudioCard = (task: Omit<StudioTaskPayload, "jobId">, conversation: string | null) => {
    const card: Msg = {
      id: crypto.randomUUID(),
      role: "assistant",
      kind: "studio",
      content: "",
      payload: { ...task, jobId: null },
      live: true,
    };
    setMessages((m) => [...m, card]);
    if (conversation) void persistStudioCard(card, conversation);
    // The Studio side panel is part of the page on larger screens; on phones
    // it would cover the chat, so it stays closed and the card shows progress.
    if (isDesktop()) emitAppEvent("open:studio");
  };

  const retryFailedTurn = async () => {
    const history = failedTurn;
    if (!history || streaming) return;
    setFailedTurn(null);
    setMessages((m) => m.filter((x) => x.kind !== "error"));
    await runChatStream(history);
  };

  const pickStarter = (s: Starter) => {
    if (s.prompt) return void send(s.prompt);
    if (s.prefill) {
      setInput(s.prefill);
      requestAnimationFrame(() => composerRef.current?.focus());
    }
  };

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
    const hasAttachments = attachments.length > 0;
    if ((!text && !hasAttachments) || streaming || clarifying) return;
    if (attachments.some((a) => a.status === "reading")) {
      toast.message("Still reading your files…");
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

    let activeConversationId: string;
    try {
      activeConversationId = await ensureConversation(text || visibleText);
    } catch (error) {
      toast.error(
        error instanceof Error && error.message.includes("not initialized")
          ? "Chat storage is not initialized"
          : "Could not start this conversation",
        {
          description:
            error instanceof Error && error.message.includes("not initialized")
              ? "Apply the latest Supabase migration, then refresh Mellox."
              : error instanceof Error
                ? error.message
                : "Please refresh and try again.",
        },
      );
      return;
    }

    const userMsg: Msg = {
      id: crypto.randomUUID(),
      role: "user",
      kind: "text",
      content: displayContent,
      live: true,
    };
    const priorMessages = messagesRef.current;
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setAttachments([]);
    requestAnimationFrame(() => scrollToLatest());

    recordTokens(Math.ceil(wireContent.length / 4));

    await supabase.from("chat_messages").insert({
      id: userMsg.id,
      workspace_id: workspaceId,
      conversation_id: activeConversationId,
      user_id: userId,
      role: "user",
      kind: "text",
      content: displayContent,
      status: "completed",
    });
    if (priorMessages.length === 0) {
      void supabase
        .from("conversations")
        .update({ title: titleFromPrompt(text || visibleText) })
        .eq("id", activeConversationId);
    }
    emitAppEvent("chat:conversation-changed");

    // Stash the wire content on the msg for history construction below.
    (userMsg as any)._wire = wireContent;

    // "Make me a …": start it in Studio now. No composer pop-up, no model round trip.
    const intent = !hasAttachments ? detectCreateIntent(text) : null;
    if (intent) {
      const format = STUDIO_FORMATS[intent.type];
      const sessionId = startInBackground({
        workspaceId,
        type: intent.type,
        brief: intent.brief,
        origin: "chat",
      });
      if (sessionId) {
        const ack: Msg = {
          id: crypto.randomUUID(),
          role: "assistant",
          kind: "text",
          content: `On it — I'm making your ${format.noun} in Studio. ${format.estimate}, and you can keep chatting while it works.`,
          live: true,
        };
        setMessages((m) => [...m, ack]);
        void supabase.from("chat_messages").insert({
          id: ack.id,
          workspace_id: workspaceId,
          conversation_id: activeConversationId,
          user_id: userId,
          role: "assistant",
          kind: "text",
          content: ack.content,
          status: "completed",
        });
        addStudioCard(
          { sessionId, type: intent.type, brief: intent.brief, workspaceId },
          activeConversationId,
        );
        return;
      }
    }

    // Ask clarifying questions only when a conversation starts; follow-ups
    // already have the context and should get an answer straight away.
    let payload: ClarifyPayload | null = null;
    if (priorMessages.filter((m) => m.role === "user").length === 0 && text.length > 0) {
      setClarifying(true);
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
      } catch {
        /* answer without clarifying */
      }
    }

    if (payload) {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          kind: "clarify",
          content: "",
          payload: { ...payload, done: false },
          live: true,
        },
      ]);
      // Wait for the user to submit/skip via ClarifyCard handlers.
      return;
    }

    setClarifying(false);
    const history = [...priorMessages, userMsg]
      .filter((m) => m.kind === "text")
      .slice(-12)
      .map((m) => ({ role: m.role, content: (m as any)._wire || m.content }));
    await runChatStream(history, detectChatActions(text));
  };

  /** Answer the last question again, replacing the reply shown after it. */
  const regenerateLatest = async () => {
    if (streaming || clarifying) return;
    const current = messagesRef.current;
    const lastUserIdx = current
      .map((m) => m.role === "user" && m.kind === "text")
      .lastIndexOf(true);
    if (lastUserIdx === -1) return;
    const kept = current.slice(0, lastUserIdx + 1);
    setMessages(kept);
    const history = kept
      .filter((m) => m.kind === "text")
      .slice(-12)
      .map((m) => ({ role: m.role, content: (m as any)._wire || m.content }));
    await runChatStream(history);
  };

  const runChatStream = async (
    history: { role: string; content: string }[],
    detectedActions: ChatAction[] = [],
  ) => {
    // Captured when the request starts: the reply is saved to THIS workspace
    // and conversation even if the user opens another chat before it finishes.
    const streamWorkspaceId = workspaceId;
    const streamConversationId = conversationRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    setFailedTurn(null);
    setStreaming(true);
    emitAppEvent("chat:working", { label: "Mellox is thinking…" });
    const lastUser = [...history].reverse().find((h) => h.role === "user")?.content ?? "";
    if (lastUser) {
      const plan = planFromPrompt(lastUser, { siteUrl, brand: dna.brandName });
      startPreviewPlan(plan);
    }
    try {
      const smartCtx = buildSmartChatContext(lastUser, ctxSources, 2500);
      // The server summarises older turns (history-summary.server.ts); the
      // client only sends the recent window, within the route's 40-turn cap.
      const recentMessages = history.slice(-40);

      const res = await authedFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: recentMessages,
          context: smartCtx,
          modelId,
          workspaceId: streamWorkspaceId,
        }),
        signal: controller.signal,
        workspaceId: streamWorkspaceId,
      });

      if (!res.ok || !res.body) {
        const errorPayload = await res.json().catch(() => null);
        const detail =
          typeof errorPayload?.error === "string" ? errorPayload.error : "Please try again.";
        const reason =
          res.status === 429
            ? "You're sending messages quickly. Wait a moment and try again."
            : res.status === 402
              ? "You've used all your AI credits for now."
              : res.status === 401 || res.status === 503
                ? "The AI service isn't set up yet."
                : detail;
        setFailedTurn(history);
        setMessages((m) => [
          ...m,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            kind: "error",
            content: reason,
            live: true,
          },
        ]);
        setStreaming(false);
        emitAppEvent("chat:idle");
        stopPreviewPlan();
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";
      let truncated = false;
      const aId = crypto.randomUUID();
      setMessages((m) => [
        ...m,
        { id: aId, role: "assistant", kind: "text", content: "", status: "streaming", live: true },
      ]);
      while (true) {
        if (controller.signal.aborted) {
          await reader.cancel().catch(() => {});
          break;
        }
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
            // Server marker: the reply hit the output ceiling (meterSseStream).
            if (parsed?.mellox?.truncated) truncated = true;
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              acc += delta;
              // Hide an action tag while it is still being written.
              const visible = acc.replace(/\[\[action:[^\]]*(?:\]\]|$)/g, "");
              setMessages((m) => m.map((x) => (x.id === aId ? { ...x, content: visible } : x)));
            }
          } catch {
            buf = line + "\n" + buf;
            break;
          }
        }
      }
      if (truncated) {
        acc += "\n\n_(This reply hit the length limit. Say “continue” to get the rest.)_";
      }
      recordTokens(Math.ceil(acc.length / 4));

      // Action tags become buttons and approval cards under the reply.
      // Nothing is opened or run here.
      let offers: ChatToolCall[] = [];
      let suggestions: ChatToolCall[] = [];
      try {
        const { parseToolCalls, requiresApproval } = await import("@/lib/chat-tools");
        const { calls, cleaned } = parseToolCalls(acc);
        acc = cleaned;
        suggestions = calls.filter((c) => requiresApproval(c.kind));
        offers = calls.filter((c) => !requiresApproval(c.kind));
      } catch (e) {
        console.warn("tool parse failed", e);
      }
      setMessages((m) =>
        m.map((x) => (x.id === aId ? { ...x, content: acc, status: "completed" } : x)),
      );
      if (offers.length || suggestions.length || detectedActions.length) {
        const payload: ActionsPayload = { offers, suggestions, actions: detectedActions };
        setMessages((m) => [
          ...m,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            kind: "actions",
            content: "",
            payload,
            live: true,
          },
        ]);
      }

      if (streamConversationId && acc.trim()) {
        await supabase.from("chat_messages").insert({
          id: aId,
          workspace_id: streamWorkspaceId,
          conversation_id: streamConversationId,
          user_id: userId,
          role: "assistant",
          kind: "text",
          content: acc,
          status: "completed",
        });
        emitAppEvent("chat:conversation-changed");
      }
    } catch (error) {
      stopPreviewPlan();
      if ((error as Error)?.name === "AbortError" || controller.signal.aborted) {
        // The user stopped it. Keep whatever streamed in and say so, rather
        // than reporting a connection failure they caused deliberately.
        setMessages((m) => [
          ...m.map((x) => (x.status === "streaming" ? { ...x, status: "cancelled" as const } : x)),
          {
            id: crypto.randomUUID(),
            role: "assistant",
            kind: "notice",
            content: "Stopped.",
            live: true,
          },
        ]);
      } else {
        setFailedTurn(history);
        setMessages((m) => [
          ...m.filter((x) => !(x.status === "streaming" && !x.content)),
          {
            id: crypto.randomUUID(),
            role: "assistant",
            kind: "error",
            content:
              (error as Error)?.message?.trim() ||
              "The connection dropped before the reply finished.",
            live: true,
          },
        ]);
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
      setMessages((m) =>
        m.map((x) => (x.status === "streaming" ? { ...x, status: "completed" as const } : x)),
      );
      emitAppEvent("chat:idle");
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
      live: true,
    };
    const prior = messagesRef.current;
    setMessages((m) => [...m, synthetic]);
    const activeConversationId = await ensureConversation();
    await supabase.from("chat_messages").insert({
      id: synthetic.id,
      workspace_id: workspaceId,
      conversation_id: activeConversationId,
      user_id: userId,
      role: "user",
      kind: "text",
      content: userClarification,
      status: "completed",
    });

    const history = [...prior, synthetic]
      .filter((m) => m.kind === "text")
      .slice(-14)
      .map((m) => ({ role: m.role, content: (m as any)._wire || m.content }));
    await runChatStream(history);
  };

  const skipClarify = (msgId: string) => {
    setMessages((arr) =>
      arr.map((x) =>
        x.id === msgId ? { ...x, payload: { ...x.payload, done: true, submitted: {} } } : x,
      ),
    );
    setClarifying(false);
    const history = messagesRef.current
      .filter((x) => x.kind === "text")
      .slice(-12)
      .map((x) => ({ role: x.role, content: (x as any)._wire || x.content }));
    void runChatStream(history);
  };

  const executeOffer = async (call: ChatToolCall): Promise<ChatToolResult> => {
    const { executeToolCall } = await import("@/lib/chat-tools");
    return executeToolCall(call, { workspaceId, saveMemory: saveMemoryNote });
  };

  /* ───────────── render ───────────── */

  const empty = messages.length === 0 && !historyLoading;
  const last = messages[messages.length - 1];
  const lastTextIdx = messages
    .map((m) => m.kind === "text" && m.role === "assistant")
    .lastIndexOf(true);
  const waitingForWords =
    clarifying && !messages.some((m) => m.kind === "clarify" && !m.payload?.done)
      ? true
      : streaming && (last?.role !== "assistant" || (last.kind === "text" && !last.content));
  const lastUserText = [...messages].reverse().find((m) => m.role === "user")?.content;
  const showNextSteps =
    !streaming &&
    !clarifying &&
    last?.role === "assistant" &&
    ((last.kind === "text" && !!last.content) || last.kind === "actions");

  const placeholder = attachments.length
    ? "Ask something about your files…"
    : empty
      ? "How can Mellox help today?"
      : "Reply to Mellox…";

  const layoutTransition = reducedMotion
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 260, damping: 32, mass: 0.9 };

  return (
    <LayoutGroup id="mellox-chat">
      <div className="mx-chat relative flex h-full min-h-0 flex-col">
        {/* Conversation (or the greeting above the centered message box) */}
        <div
          ref={scrollRef}
          onScroll={onChatScroll}
          className={cn(
            "mx-scroll min-h-0 overflow-y-auto overscroll-contain",
            empty ? "flex flex-[1_1_0%] flex-col justify-end pb-7" : "flex-1",
          )}
        >
          {empty ? (
            <ChatGreeting name={userName} brand={dna.brandName} reducedMotion={reducedMotion} />
          ) : (
            <div
              ref={contentRef}
              className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-4 pb-12 pt-6 md:px-6 md:pt-10"
            >
              {historyLoading && messages.length === 0 ? <HistorySkeleton /> : null}
              {messages.map((m, i) => {
                const animate = !!m.live && !reducedMotion;
                if (m.kind === "clarify" && m.payload) {
                  return (
                    <motion.div
                      key={m.id}
                      initial={animate ? { opacity: 0, y: 10 } : false}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3 }}
                    >
                      <ClarifyCard
                        payload={m.payload}
                        done={!!m.payload.done}
                        submittedAnswers={m.payload.submitted}
                        onSubmit={(answers) => void continueAfterClarify(m.id, answers, m.payload)}
                        onSkip={() => skipClarify(m.id)}
                      />
                    </motion.div>
                  );
                }
                if (m.kind === "studio" && m.payload) {
                  return <StudioTaskCard key={m.id} task={m.payload as StudioTaskPayload} />;
                }
                if (m.kind === "actions") {
                  const p = (m.payload ?? {}) as ActionsPayload;
                  return (
                    <div key={m.id} className="-mt-3 flex flex-col gap-3">
                      <ChatOffers
                        offers={p.offers}
                        actions={p.actions}
                        execute={executeOffer}
                        onStudioStarted={(result, call) =>
                          addStudioCard(
                            {
                              sessionId: result.sessionId ?? null,
                              type:
                                getStudioState().sessions.find((s) => s.id === result.sessionId)
                                  ?.type ?? "social",
                              brief: call.params.brief || call.params.prompt || "",
                              workspaceId,
                            },
                            conversationRef.current,
                          )
                        }
                      />
                      {p.suggestions?.length ? (
                        <SuggestedActions suggestions={p.suggestions} execute={executeOffer} />
                      ) : null}
                    </div>
                  );
                }
                if (m.kind === "notice") return <NoticeMessage key={m.id} content={m.content} />;
                if (m.kind === "error") {
                  return (
                    <ErrorMessage
                      key={m.id}
                      content={m.content}
                      onRetry={
                        i === messages.length - 1 && failedTurn
                          ? () => void retryFailedTurn()
                          : undefined
                      }
                    />
                  );
                }
                if (m.role === "user") {
                  return (
                    <UserMessage
                      key={m.id}
                      content={m.content}
                      animate={animate}
                      onEdit={(t) => {
                        setInput(t);
                        requestAnimationFrame(() => composerRef.current?.focus());
                      }}
                    />
                  );
                }
                // An empty reply that hasn't started yet shows the thinking row instead.
                if (m.status === "streaming" && !m.content) return null;
                return (
                  <AssistantMessage
                    key={m.id}
                    content={m.content}
                    streaming={m.status === "streaming"}
                    isLast={i === lastTextIdx}
                    reducedMotion={reducedMotion}
                    animate={animate}
                    onRetry={
                      i === lastTextIdx && !streaming ? () => void regenerateLatest() : undefined
                    }
                  />
                );
              })}

              <AnimatePresence>
                {waitingForWords ? (
                  <ThinkingIndicator
                    key="thinking"
                    label={clarifying ? "Reading your message" : undefined}
                  />
                ) : null}
              </AnimatePresence>

              {showNextSteps ? (
                <NextStepSuggestions
                  lastUserMessage={lastUserText}
                  onPick={(p) => void send(p)}
                  workspaceId={workspaceId}
                  brandContext={chatContext}
                />
              ) : null}
            </div>
          )}
        </div>

        {/* Message box — centered for a new chat, pinned to the bottom after */}
        <motion.div
          layout="position"
          transition={layoutTransition}
          className="relative z-10 mx-auto w-full max-w-3xl shrink-0 px-3 md:px-6"
        >
          <AnimatePresence>
            {showJumpToLatest && !empty ? (
              <motion.button
                key="jump"
                type="button"
                initial={{ opacity: 0, y: 8, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.9 }}
                transition={{ duration: 0.18 }}
                onClick={() => scrollToLatest()}
                aria-label="Scroll to latest message"
                className="mx-jump"
              >
                <ArrowDown className="size-4" />
              </motion.button>
            ) : null}
          </AnimatePresence>
          {!empty ? <div className="mx-composer-fade" aria-hidden /> : null}
          {mobileAccessory ? <div className="mb-2">{mobileAccessory}</div> : null}
          <ChatComposer
            ref={composerRef}
            hero={empty}
            value={input}
            onChange={setInput}
            onSend={() => void send()}
            onStop={stopStreaming}
            onAddFiles={(f) => void addFiles(f)}
            onRemoveAttachment={removeAttachment}
            attachments={attachments}
            streaming={streaming}
            busy={clarifying}
            modelId={modelId}
            onModelChange={changeModel}
            placeholder={placeholder}
          />
        </motion.div>

        {/* Starters under the centered box, or a quiet note under the bottom one */}
        <div
          className={cn(
            "shrink-0 px-3 md:px-6",
            empty
              ? "flex flex-[1_1_0%] flex-col items-center pt-5"
              : "pb-[max(0.625rem,env(safe-area-inset-bottom))] pt-2",
          )}
        >
          {empty ? (
            <ChatStarters onPick={pickStarter} reducedMotion={reducedMotion} />
          ) : (
            <p className="text-center text-[11.5px] text-muted-foreground/80">
              Mellox can make mistakes. Check important details.
            </p>
          )}
        </div>
      </div>
    </LayoutGroup>
  );
}

function HistorySkeleton() {
  return (
    <div className="flex flex-col gap-7" aria-hidden>
      <div className="ml-auto h-10 w-1/2 animate-pulse rounded-2xl bg-muted" />
      <div className="space-y-2.5">
        <div className="h-3 w-11/12 animate-pulse rounded-full bg-muted" />
        <div className="h-3 w-4/5 animate-pulse rounded-full bg-muted" />
        <div className="h-3 w-3/5 animate-pulse rounded-full bg-muted" />
      </div>
    </div>
  );
}
