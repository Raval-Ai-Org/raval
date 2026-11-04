"use client";

// Development-only visual check for Mellox 2.0's frame, sidebar and Home
// (`/home-lab`), with sample data and no sign-in. `?scene=done` shows a brand
// that finished Start here; `?scene=waiting` shows posts waiting.

import { useState } from "react";
import { AppCanvas, AppFrame } from "@/components/app/shell/AppFrame";
import { SidebarNav } from "@/components/app/shell/SidebarNav";
import { GradProgress } from "@/components/app/surface/MoxParts";
import { Logo } from "@/components/brand/Logo";
import { MoxFace } from "@/components/brand/mox/MoxFace";
import { ChevronDown, Globe, PanelRightOpen, Share2, Sparkles } from "@/components/icons";
import { AppModalShell } from "@/components/app/AppModalShell";
import { LanguageGrid } from "@/components/onboarding/LanguageStep";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { LoadingIndicator } from "@/components/ui/loading-indicator";
import { toast } from "@/lib/toast";
import { startHere } from "@/lib/home/start-here";
import { EMPTY_PULSE, type WorkspacePulse } from "@/lib/pulse/pulse";
import { HomeBento } from "./HomeBento";
import { ChatComposer, CHAT_MODELS } from "@/components/app/chat/ChatComposer";
import { StartHereList } from "./StartHere";
import { GeneratingPanelView } from "@/components/studio/GeneratingPanel";

export function HomeLab({ scene }: { scene?: string }) {
  const [active, setActive] = useState("home");
  const [language, setLanguage] = useState("English");
  const [draft, setDraft] = useState("");
  const done = scene === "done";
  const start = {
    ...startHere({
      brandHealth: done ? 90 : 62,
      products: done ? 3 : 0,
      hasLook: done,
      hasGoal: done,
    }),
    ready: true,
  };
  const pulse: WorkspacePulse = {
    ...EMPTY_PULSE,
    waiting: scene === "waiting" ? 3 : 0,
    autopilot: { status: scene === "waiting" ? "running" : null, waiting: 0 },
  };
  if (scene === "faces") {
    const moods = ["happy", "thinking", "wow", "sad", "sleep", "excited", "scanning"] as const;
    return (
      <AppFrame>
        <div className="flex flex-wrap content-center items-center justify-center gap-10 p-10">
          {moods.map((m) => (
            <figure key={m} className="flex flex-col items-center gap-2">
              <MoxFace mood={m} size={180} track />
              <figcaption className="text-sm font-semibold">{m}</figcaption>
            </figure>
          ))}
          <figure className="flex flex-col items-center gap-2">
            <MoxFace mood="happy" visor size={180} />
            <figcaption className="text-sm font-semibold">visor</figcaption>
          </figure>
        </div>
      </AppFrame>
    );
  }
  if (scene === "states") {
    return (
      <AppFrame>
        <div className="grid flex-1 grid-cols-1 content-center gap-4 p-8 md:grid-cols-3">
          <div className="ds-card">
            <EmptyState
              icon={Sparkles}
              title="Nothing here yet"
              description="Your posts show up here."
              action={
                <button className="ds-grad-pill rounded-full px-4 py-2 text-[13px] font-bold">
                  Create a post
                </button>
              }
            />
          </div>
          <div className="ds-card">
            <ErrorState onRetry={() => toast.error("Still not loading")} />
          </div>
          <div className="ds-card grid place-items-center">
            <LoadingIndicator size="lg" label="Loading posts" showLabel />
            <button
              type="button"
              className="mb-6 rounded-full bg-foreground px-4 py-2 text-[13px] font-semibold text-background"
              onClick={() =>
                toast.success("Saved to Library", { description: "Mox will use it next time." })
              }
            >
              Show a toast
            </button>
          </div>
        </div>
      </AppFrame>
    );
  }
  const create = {
    open: () => true,
    lockFor: (c: string) => (c === "video" ? ("starter" as const) : null),
  };

  return (
    <AppFrame plain>
      <aside className="hidden w-[196px] flex-none flex-col px-2.5 pb-3 lg:flex">
        <div className="flex h-14 items-center justify-between px-1">
          <span className="flex items-center gap-1.5">
            <Logo height={26} markOnly />
            <span className="text-[13px]" style={{ fontFamily: "var(--font-brand)" }}>
              Mellox AI
            </span>
          </span>
          <PanelRightOpen className="size-4 text-muted-foreground" aria-hidden />
        </div>
        <SidebarNav
          activeId={active}
          lockFor={(item) => (item.feature === "client_portal" ? "growth" : null)}
          hintFor={(item) => (item.id === "brain" ? "3" : undefined)}
          showFlag={() => true}
          onPick={(item) => setActive(item.id)}
        />
        <div className="mt-auto flex flex-col items-center pt-3 text-center">
          <MoxFace mood="happy" size={42} />
          <GradProgress value={0.62} className="mt-1 w-20" />
          <p className="mt-1 text-[13px] font-bold tabular-nums">1,240</p>
          <p className="text-[10px] text-muted-foreground">credits</p>
        </div>
      </aside>
      <div data-workspace-column className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between px-4">
          <span className="flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 text-[13px] font-semibold">
            <span className="grid size-6 place-items-center rounded-full bg-[var(--mox-lime)] text-[11px] font-bold text-[var(--mox-ink)]">
              A
            </span>
            Acme Coffee
            <ChevronDown className="size-3 text-muted-foreground" />
          </span>
          <span className="hidden items-center gap-2.5 xl:inline-flex">
            <MoxFace mood="happy" size={22} />
            <span className="text-[12px] font-semibold">Mox knows your brand</span>
            <GradProgress value={start.done / start.total} className="w-24" />
            <span className="text-[12px] font-bold">
              {start.done}/{start.total}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="px-3 text-[12.5px] font-semibold text-foreground/80">Starter ↗</span>
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-foreground px-3.5 text-[12.5px] font-semibold text-background">
              <Share2 className="size-3.5" /> Share
            </span>
          </span>
        </header>
        <AppCanvas>
          {scene === "generating" && (
            <GeneratingPanelView
              className="absolute right-4 top-4 z-20"
              rows={[
                {
                  id: "a",
                  type: "carousel",
                  state: "working",
                  title: "5 cold brew mistakes",
                  step: "Writing the slides",
                },
                { id: "b", type: "video", state: "done", title: "Harvest morning in Huila" },
                { id: "c", type: "image", state: "done", title: "New single origin is here" },
                { id: "d", type: "ad", state: "failed" },
              ]}
              onOpen={() => undefined}
              onClose={() => undefined}
            />
          )}
          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <HomeBento
                start={start}
                name="Sam Rivera"
                pulse={pulse}
                onOpenWaiting={() => undefined}
                create={create}
                starters={
                  <div className="flex flex-wrap gap-2">
                    {["Plan my week", "Write a launch post", "What are rivals posting?"].map(
                      (t) => (
                        <span key={t} className="mx-starter">
                          {t}
                        </span>
                      ),
                    )}
                  </div>
                }
              />
            </div>
            <div className="mx-auto w-full max-w-[760px] shrink-0 px-3 pb-3.5 pt-2 md:px-6">
              <ChatComposer
                slim
                value={draft}
                onChange={setDraft}
                onSend={() => setDraft("")}
                onStop={() => undefined}
                onAddFiles={() => undefined}
                onRemoveAttachment={() => undefined}
                attachments={[]}
                streaming={false}
                busy={false}
                modelId={CHAT_MODELS[0].id}
                onModelChange={() => undefined}
                placeholder="Ask Mox anything…"
              />
            </div>
          </main>
        </AppCanvas>
      </div>
      {scene === "modal" && (
        <AppModalShell
          open
          onOpenChange={() => undefined}
          size="sm"
          Icon={Sparkles}
          title="Start here"
          srDescription="Steps that teach Mox your brand"
        >
          <div className="p-4">
            <StartHereList steps={start.steps} onPick={() => undefined} />
          </div>
        </AppModalShell>
      )}
      {scene === "language" && (
        <AppModalShell
          open
          onOpenChange={() => undefined}
          size="xl"
          Icon={Globe}
          title="Settings"
          srDescription="Content language"
        >
          <div className="p-6">
            <h2 className="text-[22px] font-bold">Language</h2>
            <p className="mb-4 text-[13px] text-muted-foreground">What Mox writes your posts in</p>
            <LanguageGrid value={language} onChange={setLanguage} listClassName="max-h-[52dvh]" />
          </div>
        </AppModalShell>
      )}
    </AppFrame>
  );
}
