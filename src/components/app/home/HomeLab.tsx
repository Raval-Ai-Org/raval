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
import { StudioButtonView } from "@/components/studio/StudioButton";
import {
  AnimateFlowView,
  EMPTY_ANIMATE_DRAFT,
  type AnimateDraft,
  type AnimatePicture,
} from "@/components/studio/AnimateFlow";
import { StreakChipView } from "@/components/app/shell/Momentum";
import { localDay, momentum } from "@/lib/home/momentum";
import { animateStyles } from "@/lib/studio/repurpose";
import { CreateLauncher } from "@/components/studio/CreateLauncher";

/** Sample Library pictures, drawn so the lab needs no network. */
const LAB_PICTURES: AnimatePicture[] = [
  ["#1F4D3A", "#F2C14E", "Drink of the summer"],
  ["#E9A23B", "#2F6B4F", "Feel good all summer"],
  ["#2E5E4E", "#F6D58E", "Crisp and cold"],
  ["#F4B6A6", "#3B2F6B", "New flavour"],
  ["#3D5AFE", "#FFE082", "Pool day"],
  ["#6D4C41", "#FFCC80", "Morning roast"],
  ["#00897B", "#FFF59D", "Iced latte"],
].map(([bg, fg, words], i) => ({
  assetId: `lab-${i}`,
  url:
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="${bg}"/><circle cx="200" cy="300" r="120" fill="${fg}" opacity="0.9"/><rect x="160" y="230" width="80" height="150" rx="18" fill="#fff" opacity="0.92"/><text x="200" y="96" text-anchor="middle" font-family="Georgia" font-size="34" font-weight="700" fill="${fg}" textLength="340" lengthAdjust="spacingAndGlyphs">${words}</text></svg>`,
    ),
  title: words,
  postId: i % 2 ? null : `post-${i}`,
  type: "image" as const,
}));

function labMomentum(scene?: string) {
  const at = new Date();
  const day = (back: number) =>
    localDay(new Date(at.getFullYear(), at.getMonth(), at.getDate() - back));
  if (scene === "streak")
    return momentum({ days: [1, 2, 3, 4, 5].map(day), total: 31, today: day(0) });
  if (scene === "done") return momentum({ days: [0, 1, 2].map(day), total: 7, today: day(0) });
  return momentum({ days: [], total: 0, today: day(0) });
}

export function HomeLab({ scene }: { scene?: string }) {
  const [active, setActive] = useState("home");
  const [language, setLanguage] = useState("English");
  const [draft, setDraft] = useState("");
  const done = scene === "done" || scene === "streak";
  const m = labMomentum(scene);
  const [animateDraft, setAnimateDraft] = useState<AnimateDraft>({
    ...EMPTY_ANIMATE_DRAFT,
    chosen: scene === "animate-empty" ? null : LAB_PICTURES[1],
    // "animate-motion" shows a picked end frame too.
    end: scene === "animate-motion" ? (LAB_PICTURES[2] ?? null) : null,
    style: animateStyles().find((s) => s.videoKind === "living-picture") ?? null,
  });
  const [labPictures, setLabPictures] = useState<AnimatePicture[]>(LAB_PICTURES);
  const animating = scene === "animate" || scene === "animate-motion" || scene === "animate-empty";
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
      <aside className="hidden h-full w-[196px] flex-none flex-col px-2.5 pb-3 lg:flex">
        {/* Same as AppShell: the logo row never shrinks, the rows scroll and
            Mox's gauge stays at the bottom, so short windows don't overlap. */}
        <div className="flex h-14 shrink-0 items-center justify-between px-1">
          <span className="flex items-center gap-1.5">
            <Logo height={26} markOnly />
            <span className="text-[13px]" style={{ fontFamily: "var(--font-brand)" }}>
              Mellox
            </span>
          </span>
          <PanelRightOpen className="size-4 text-muted-foreground" aria-hidden />
        </div>
        <div className="-mx-2.5 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 pb-3 pt-2">
          <SidebarNav
            activeId={active}
            lockFor={(item) => (item.feature === "client_portal" ? "growth" : null)}
            hintFor={(item) => (item.id === "brain" ? "3" : undefined)}
            showFlag={() => true}
            onPick={(item) => setActive(item.id)}
          />
        </div>
        <div className="flex shrink-0 flex-col items-center border-t border-[var(--ds-card-border)] pt-2.5 text-center">
          <MoxFace mood="happy" size={42} />
          <GradProgress value={0.62} className="mt-1 w-20" />
          <p className="mt-1 text-[13px] font-bold tabular-nums">1,240</p>
          <p className="text-[10px] text-muted-foreground">credits</p>
        </div>
      </aside>
      {/* Same as AppShell: on a desktop the canvas starts at the very top and
          the top bar sits on it, not on a white strip. */}
      <div
        data-workspace-column
        className="flex min-w-0 flex-1 flex-col lg:ds-canvas lg:overflow-hidden lg:rounded-tl-[var(--ds-canvas-radius)]"
      >
        <header className="relative z-20 flex h-14 shrink-0 items-center justify-between px-4">
          <span className="flex min-w-0 items-center gap-2 whitespace-nowrap rounded-full py-1.5 pl-1.5 pr-3 text-[13px] font-semibold">
            <span className="grid size-6 place-items-center rounded-full bg-[var(--mox-lime)] text-[11px] font-bold text-[var(--mox-ink)]">
              A
            </span>
            Acme Coffee
            <ChevronDown className="size-3 text-muted-foreground" />
            <StreakChipView m={m} className="ml-1 hidden md:inline-flex" />
          </span>
          <span className="flex items-center gap-1.5">
            <span className="hidden whitespace-nowrap px-3 text-[12.5px] font-semibold text-foreground/80 lg:inline">
              Starter ↗
            </span>
            <StudioButtonView state="idle" working={0} unseen={0} onClick={() => {}} />
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-foreground px-3.5 text-[12.5px] font-semibold text-background">
              <Share2 className="size-3.5" /> <span className="hidden sm:inline">Share</span>
            </span>
          </span>
        </header>
        <AppCanvas className="lg:rounded-none lg:bg-transparent lg:bg-none lg:shadow-none">
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
                {
                  id: "task:strategy",
                  title: "Marketing strategy",
                  state: "done",
                  doneLabel: "Ready to review",
                },
              ]}
              onOpen={() => undefined}
              onClose={() => undefined}
            />
          )}
          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
              {/* Big windows open in the canvas in the app; the lab draws the
                  Animate view there directly. */}
              {animating ? (
                <div className="px-4 pb-4 pt-4 sm:px-6">
                  <AnimateFlowView
                    pictures={scene === "animate-empty" ? [] : labPictures}
                    error={null}
                    draft={animateDraft}
                    autoRatio="9:16"
                    lock={null}
                    onDraft={(p) => setAnimateDraft((d) => ({ ...d, ...p }))}
                    onRetry={() => undefined}
                    onSeeLibrary={() => toast("Opens the Library")}
                    onOpenStudio={() => toast.success("Opens the video draft in Studio")}
                    onUpload={(f, slot) => {
                      const p = {
                        assetId: `upload-${f.name}`,
                        url: URL.createObjectURL(f),
                        title: f.name,
                        postId: null,
                        type: null,
                      };
                      setLabPictures((list) => [p, ...list]);
                      setAnimateDraft((d) =>
                        slot === "end" ? { ...d, end: p } : { ...d, chosen: p },
                      );
                    }}
                  />
                </div>
              ) : (
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
              )}
            </div>
            {/* The message box belongs to Home; a window on the canvas covers it. */}
            <div
              hidden={animating}
              className="mx-auto w-full max-w-[760px] shrink-0 px-3 pb-3.5 pt-2 md:px-6"
            >
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
      {/* Create is a page on the canvas, as in the app (open:create-launcher). */}
      <CreateLauncher />
    </AppFrame>
  );
}
