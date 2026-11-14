"use client";

// Development-only: the one-question onboarding (ADR-0049) with sample data,
// chosen with `?step=ask&id=<screen id>` (role, focus, rhythm, tone, look,
// channels, hello, story-plan…), `?step=review|audience|language|done`, and
// `?scan=loading|ok|error` for the dock. Nothing talks to a server; the last
// thing a button would do is written to `lab-last`.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LayoutGroup } from "framer-motion";
import type { Discoveries } from "@/lib/brand-extract-events";
import type { ScanState } from "@/lib/onboarding/brains";
import type { Answers, OnboardingChannel } from "@/lib/onboarding/answers";
import { askScreens } from "@/lib/onboarding/questions";
import { useReducedMotionSafe } from "@/hooks/use-reduced-motion-safe";
import { Stage, type StageAction } from "./Stage";
import { ScanDock } from "./ScanDock";
import { PickScreen } from "./PickScreen";
import { SayScreen } from "./SayScreen";
import { ChannelsScreen } from "./ChannelsScreen";
import { LookSwipe, LOOK_MIN_SWIPES } from "./LookSwipe";
import { AnswerTrail, AudiencePick, BrandCard, LanguagePick } from "./AfterSteps";
import { DoneStep } from "./DoneStep";
import { UrlStep } from "../UrlStep";

export const ASK_LAB_STEPS = [
  "website",
  "manual",
  "ask",
  "review",
  "audience",
  "products",
  "language",
  "done",
] as const;

/** A screen the lab owns (products, the no-website kit), shown in the stage. */
export type LabSlot = { node: ReactNode; action: StageAction | null; scan: boolean };

const DISCOVERIES: Discoveries = {
  site: {
    hostname: "northwind.example",
    siteName: "Northwind Coffee",
    title: "Northwind Coffee",
    description: "Small-batch coffee from Leeds",
    themeColor: "#1F3B2D",
    faviconUrl: null,
    logoUrl: null,
    ogImageUrl: null,
  },
  identity: {
    colors: ["#1F3B2D", "#C8F169", "#F4F1EA", "#2B2118"],
    fonts: [],
    structuredData: 2,
    headings: 12,
    socialPlatforms: ["instagram"],
  },
  pages: { paths: ["/", "/shop", "/about", "/subscribe"], sitemapUrls: 18 },
  market: { mentions: 4, about: 2, competitors: 3, reviews: 6 },
};

const AUDIENCE = [
  "Busy professionals who care where their coffee comes from",
  "Home baristas with a grinder",
  "Offices ordering weekly",
  "Gift buyers",
];

export function AskLab({
  step,
  slot,
  onLast,
}: {
  step: string;
  slot?: LabSlot;
  onLast: (what: string) => void;
}) {
  const reduce = useReducedMotionSafe();
  const params = useMemo(
    () =>
      typeof window === "undefined"
        ? new URLSearchParams()
        : new URLSearchParams(window.location.search),
    [],
  );
  const scan = (params.get("scan") as ScanState | null) ?? "loading";
  const [answers, setAnswers] = useState<Answers>({
    role: "owner",
    teamSize: "small",
    focus: "followers",
    activity: "sometimes",
    tone: params.get("tone") === "funny" ? "funny" : "auto",
  });
  const screens = askScreens(answers, { mode: "site", sourceKnown: false });
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      screens.findIndex((s) => s.id === (params.get("id") ?? "role")),
    ),
  );
  const [audience, setAudience] = useState(AUDIENCE.slice(0, 2));
  const [language, setLanguage] = useState("English");
  const [flash, setFlash] = useState(0);
  const [site, setSite] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus({ preventScroll: true }), [index]);

  const screen = screens[Math.min(index, screens.length - 1)];
  const next = () => setIndex((i) => Math.min(i + 1, screens.length - 1));

  const swiped = (answers.likes?.length ?? 0) + (answers.skips?.length ?? 0);
  const action: StageAction | null = slot
    ? slot.action
    : step === "ask"
      ? screen.kind === "say" || screen.kind === "channels"
        ? { label: "Continue", onClick: () => (onLast(`ask:${screen.id}:continue`), next()) }
        : screen.kind === "swipe"
          ? swiped >= LOOK_MIN_SWIPES
            ? { label: "Continue", onClick: () => onLast("look:continue") }
            : { label: "Skip", quiet: true, onClick: () => onLast("look:skip") }
          : null
      : step === "done" || step === "website"
        ? null
        : {
            label: step === "review" ? "Looks right" : "Continue",
            onClick: () => onLast(`${step}:continue`),
          };

  const trail = screens.slice(0, index).flatMap((s) => {
    if (s.kind !== "pick") return [];
    const o = s.options.find((x) => x.value === answers[s.id]);
    return o ? [{ id: s.id, label: o.label }] : [];
  });

  const pct = scan === "ok" ? 100 : scan === "error" ? 40 : 56;
  return (
    <LayoutGroup>
      <Stage
        scene={step === "done" ? "finish" : step === "website" ? "world" : "wash"}
        progress={step === "ask" ? 0.06 + (0.64 * index) / screens.length : 0.8}
        minutes={step === "done" ? null : 2}
        hideHeader={step === "done"}
        trail={step === "ask" ? <AnswerTrail chips={trail} reduce={reduce} /> : undefined}
        screenKey={step === "ask" ? `ask:${screen.id}` : step}
        reduce={reduce}
        onBack={
          step === "done"
            ? null
            : () => (step === "ask" ? setIndex((i) => Math.max(0, i - 1)) : onLast("back"))
        }
        onSkip={step === "done" ? null : () => onLast("skip")}
        action={action}
        scan={
          step === "done" || step === "website" || (slot && !slot.scan) ? null : (
            <ScanDock
              url="https://northwind.example"
              status={scan}
              pct={pct}
              phase={scan === "ok" ? 4 : 2}
              message={scan === "loading" ? "Reading reviews and mentions" : undefined}
              discoveries={DISCOVERIES}
              flash={flash}
              reduce={reduce}
              onRetry={() => onLast("scan:retry")}
            />
          )
        }
      >
        {step === "ask" && screen.kind === "say" && (
          <SayScreen screen={screen} reduce={reduce} headingRef={headingRef} onNext={next} />
        )}
        {step === "ask" && screen.kind === "pick" && (
          <PickScreen
            screen={screen}
            value={undefined}
            reduce={reduce}
            headingRef={headingRef}
            onPick={(v) => {
              setAnswers((a) => ({ ...a, [screen.id]: v }));
              setFlash((n) => n + 1);
              onLast(`pick:${screen.id}:${v}`);
              next();
            }}
          />
        )}
        {step === "ask" && screen.kind === "channels" && (
          <ChannelsScreen
            screen={screen}
            value={answers.channels ?? []}
            reduce={reduce}
            headingRef={headingRef}
            onChange={(channels: OnboardingChannel[]) => setAnswers((a) => ({ ...a, channels }))}
          />
        )}
        {step === "ask" && screen.kind === "swipe" && (
          <LookSwipe
            screen={screen}
            likes={answers.likes ?? []}
            skips={answers.skips ?? []}
            reduce={reduce}
            headingRef={headingRef}
            onSwipe={(id, liked) => {
              onLast(`swipe:${id}:${liked ? "like" : "skip"}`);
              setAnswers((a) => ({
                ...a,
                likes: liked ? [...(a.likes ?? []), id] : (a.likes ?? []),
                skips: liked ? (a.skips ?? []) : [...(a.skips ?? []), id],
              }));
            }}
            onDone={() => onLast("look:done")}
          />
        )}
        {slot && (
          <div className="h-full overflow-y-auto overscroll-contain px-1 pb-4">{slot.node}</div>
        )}
        {step === "website" && (
          <div className="ob-scene-content" data-side="right">
            <div className="ob-scene-panel ob-glass rounded-[32px] p-5 sm:p-7">
              <UrlStep
                value={site}
                reduce={reduce}
                headingRef={headingRef}
                onChange={setSite}
                onSubmit={() => onLast("website:scan")}
                onNoWebsite={() => onLast("website:none")}
              />
            </div>
          </div>
        )}
        {step === "review" && (
          <BrandCard
            brand={{
              brandName: "Northwind Coffee",
              oneLiner: "Small-batch coffee roasted in Leeds, delivered weekly",
              audience: AUDIENCE[0],
              voice: "Warm, expert, a little dry",
              industry: "Food & drink",
              colors: [
                { name: "Forest", hex: "#1F3B2D" },
                { name: "Lime", hex: "#C8F169" },
                { name: "Oat", hex: "#F4F1EA" },
              ],
            }}
            url="https://northwind.example"
            reduce={reduce}
            headingRef={headingRef}
            onChange={(p) => onLast(`review:edit:${Object.keys(p).join(",")}`)}
          />
        )}
        {step === "audience" && (
          <AudiencePick
            options={AUDIENCE}
            value={audience}
            reduce={reduce}
            headingRef={headingRef}
            onChange={setAudience}
          />
        )}
        {step === "language" && (
          <LanguagePick
            value={language}
            reduce={reduce}
            headingRef={headingRef}
            onChange={setLanguage}
          />
        )}
        {step === "done" && (
          <DoneStep
            brandName="Northwind Coffee"
            learned={{
              brand: "Warm tone · English",
              audience: AUDIENCE[0],
              competitors: "3 rivals found",
              market: "Food & drink",
            }}
            plan="3 posts a week · you approve each post"
            reduce={reduce}
            headingRef={headingRef}
            onEnter={() => onLast("done:enter")}
          />
        )}
      </Stage>
    </LayoutGroup>
  );
}
