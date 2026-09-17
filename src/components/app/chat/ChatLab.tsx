"use client";

// Development-only visual QA for the chat: the same pieces and layout as
// ChatPanel, driven by sample data — no workspace, sign-in or AI calls.
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { ChatToolCall } from "@/lib/chat-tools";
import { ChatComposer, CHAT_MODELS, type ChatComposerHandle } from "./ChatComposer";
import { ChatGreeting, ChatStarters } from "./ChatEmptyState";
import { AssistantMessage, UserMessage } from "./ChatMessages";
import { ChatOffers } from "./ChatOffers";
import { StudioTaskCard } from "./StudioTaskCard";
import { ThinkingIndicator } from "./ThinkingIndicator";

type LabMsg =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string; streaming: boolean }
  | { id: string; kind: "offers" }
  | { id: string; kind: "studio"; view: "working" | "ready" | "failed" };

const REPLY = `**TL;DR:** Your fastest win is turning your best customer stories into short LinkedIn posts — you already have the proof, it just isn't being seen.

**Key points:**
- Posts with a real customer result get about 3× more comments than product updates.
- Your site answers "what" but not "who it's for", so AI search tools skip it.
- Two competitors post daily; a steady 3 posts a week is enough to stay visible.

**Plan:**
1. Pick three customer wins from the last quarter.
2. Turn each into a short post with one clear number.
3. Add a "Who it's for" section to your homepage.

**Next step:** Start with the story that has the biggest number.`;

const OFFERS: ChatToolCall[] = [
  {
    kind: "open-studio",
    params: {
      canvas: "social",
      brief: "A LinkedIn post about how Acme cut onboarding time by 40%",
    },
    raw: "",
  },
  { kind: "open-visibility", params: {}, raw: "" },
];

export function ChatLab() {
  const [messages, setMessages] = useState<LabMsg[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const composerRef = useRef<ChatComposerHandle>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));

  const empty = messages.length === 0;

  const reply = (text: string) => {
    setMessages((m) => [...m, { id: crypto.randomUUID(), kind: "user", text }]);
    setInput("");
    if (/^(create|make|write)\b/i.test(text)) {
      const id = crypto.randomUUID();
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          kind: "assistant",
          text: "On it — I'm making your post in Studio. About 20 seconds, and you can keep chatting while it works.",
          streaming: false,
        },
        { id, kind: "studio", view: "working" },
      ]);
      later(
        () => setMessages((m) => m.map((x) => (x.id === id ? { ...x, view: "ready" } : x))),
        4000,
      );
      return;
    }
    setThinking(true);
    setStreaming(true);
    later(() => {
      setThinking(false);
      const id = crypto.randomUUID();
      setMessages((m) => [...m, { id, kind: "assistant", text: "", streaming: true }]);
      let i = 0;
      const step = () => {
        i = Math.min(REPLY.length, i + 6 + Math.floor(Math.random() * 30));
        setMessages((m) =>
          m.map((x) =>
            x.id === id && x.kind === "assistant" ? { ...x, text: REPLY.slice(0, i) } : x,
          ),
        );
        if (i < REPLY.length) later(step, 60 + Math.random() * 120);
        else {
          setMessages((m) => [
            ...m.map((x) =>
              x.id === id && x.kind === "assistant" ? { ...x, streaming: false } : x,
            ),
            { id: crypto.randomUUID(), kind: "offers" },
          ]);
          setStreaming(false);
        }
      };
      step();
    }, 1600);
  };

  const lastAssistant = messages.map((m) => m.kind === "assistant").lastIndexOf(true);

  return (
    <div className="flex h-[100dvh] flex-col bg-background text-foreground">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4 text-[12px] text-muted-foreground">
        <span className="font-medium text-foreground">Chat lab</span>
        <span>· sample data, nothing is sent</span>
        <button
          type="button"
          className="mx-pill-btn ml-auto"
          onClick={() => {
            setMessages([]);
            setThinking(false);
            setStreaming(false);
          }}
        >
          New chat
        </button>
        <button
          type="button"
          className="mx-pill-btn"
          onClick={() =>
            setMessages([
              { id: "u1", kind: "user", text: "Make an Instagram carousel about our summer menu" },
              { id: "s1", kind: "studio", view: "failed" },
              { id: "u2", kind: "user", text: "What should I post this week?" },
              { id: "a2", kind: "assistant", text: REPLY, streaming: false },
              { id: "o2", kind: "offers" },
            ])
          }
        >
          Sample conversation
        </button>
        <button
          type="button"
          className="mx-pill-btn"
          onClick={() => document.documentElement.classList.toggle("dark")}
        >
          Theme
        </button>
      </div>
      <LayoutGroup>
        <div className="mx-chat relative flex min-h-0 flex-1 flex-col">
          <div
            className={cn(
              "mx-scroll min-h-0 overflow-y-auto",
              empty ? "flex flex-[1_1_0%] flex-col justify-end pb-7" : "flex-1",
            )}
          >
            {empty ? (
              <ChatGreeting name="Zain Ali" brand="Acme Coffee" reducedMotion={false} />
            ) : (
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-4 pb-12 pt-10 md:px-6">
                {messages.map((m, i) =>
                  m.kind === "user" ? (
                    <UserMessage key={m.id} content={m.text} animate onEdit={setInput} />
                  ) : m.kind === "assistant" ? (
                    m.streaming && !m.text ? null : (
                      <AssistantMessage
                        key={m.id}
                        content={m.text}
                        streaming={m.streaming}
                        isLast={i === lastAssistant}
                        reducedMotion={false}
                        animate
                        onRetry={() => {}}
                      />
                    )
                  ) : m.kind === "offers" ? (
                    <div key={m.id} className="-mt-3">
                      <ChatOffers
                        offers={OFFERS}
                        execute={async (call) => ({ kind: call.kind, ok: true, label: "Done" })}
                      />
                    </div>
                  ) : (
                    <StudioTaskCard
                      key={m.id}
                      demo={{ view: m.view, stage: 2 }}
                      task={{
                        type: m.view === "failed" ? "carousel" : "social",
                        brief:
                          m.view === "failed"
                            ? "Instagram carousel about our summer menu"
                            : "LinkedIn post about how Acme cut onboarding time by 40%",
                        workspaceId: "lab",
                      }}
                    />
                  ),
                )}
                <AnimatePresence>{thinking ? <ThinkingIndicator key="t" /> : null}</AnimatePresence>
              </div>
            )}
          </div>
          <motion.div
            layout="position"
            transition={{ type: "spring", stiffness: 260, damping: 32, mass: 0.9 }}
            className="relative z-10 mx-auto w-full max-w-3xl shrink-0 px-3 md:px-6"
          >
            {!empty ? <div className="mx-composer-fade" aria-hidden /> : null}
            <ChatComposer
              ref={composerRef}
              hero={empty}
              value={input}
              onChange={setInput}
              onSend={() => input.trim() && reply(input.trim())}
              onStop={() => setStreaming(false)}
              onAddFiles={() => {}}
              onRemoveAttachment={() => {}}
              attachments={[]}
              streaming={streaming}
              busy={false}
              modelId={CHAT_MODELS[0].id}
              onModelChange={() => {}}
              placeholder={empty ? "How can Mellox help today?" : "Reply to Mellox…"}
            />
          </motion.div>
          <div
            className={cn(
              "shrink-0 px-3 md:px-6",
              empty ? "flex flex-[1_1_0%] flex-col items-center pt-5" : "pb-2.5 pt-2",
            )}
          >
            {empty ? (
              <ChatStarters
                reducedMotion={false}
                onPick={(s) => (s.prompt ? reply(s.prompt) : setInput(s.prefill ?? ""))}
              />
            ) : (
              <p className="text-center text-[11.5px] text-muted-foreground/80">
                Mellox can make mistakes. Check important details.
              </p>
            )}
          </div>
        </div>
      </LayoutGroup>
    </div>
  );
}
