"use client";

import { cn } from "@/lib/utils";
import { STUDIO_FORMATS } from "@/lib/studio/formats";
import type { StudioSession } from "@/lib/studio/session-store";
import { RatioFrame, Weave } from "../studio-ui";

function Line({ w, show, delay = 0 }: { w: string; show: boolean; delay?: number }) {
  return (
    <span
      className={cn(
        "relative block h-2.5 overflow-hidden rounded-full bg-surface-2 transition-opacity duration-[--motion-duration-slow]",
        show ? "opacity-100" : "opacity-30",
      )}
      style={{ width: w, transitionDelay: `${delay}ms` }}
    >
      {show ? <Weave /> : null}
    </span>
  );
}

/**
 * The shape of the result, forming as stages complete: the right format, the
 * right size, and lines that fill in as writing progresses.
 */
export function PreviewSkeleton({
  session,
  stageIndex,
}: {
  session: StudioSession;
  stageIndex: number;
}) {
  const format = STUDIO_FORMATS[session.type];
  const writingIndex = format.stages.findIndex((s) => s.id === "writing" || s.id === "captions");
  const writing = stageIndex >= Math.max(1, writingIndex);
  const ratio = session.controls.ratio ?? format.ratios[0] ?? "1:1";
  const hasMedia =
    format.media === "image" ||
    format.media === "video" ||
    (format.media === "optional-image" && session.controls.includeImage);

  if (session.type === "article") {
    return (
      <div
        className="w-full max-w-[520px] rounded-2xl border border-border bg-surface-3 p-6 shadow-1"
        aria-hidden
      >
        <Line w="70%" show />
        <div className="mt-4 space-y-2.5">
          <Line w="92%" show={writing} />
          <Line w="86%" show={writing} delay={80} />
          <Line w="60%" show={writing} delay={160} />
        </div>
        <div className="mt-6 space-y-2.5">
          <Line w="40%" show={writing} delay={240} />
          <Line w="95%" show={writing} delay={320} />
          <Line w="88%" show={writing} delay={400} />
          <Line w="74%" show={writing} delay={480} />
        </div>
      </div>
    );
  }

  if (session.type === "script") {
    return (
      <div
        className="w-full max-w-[520px] space-y-3 rounded-2xl border border-border bg-surface-3 p-6 shadow-1"
        aria-hidden
      >
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="grid grid-cols-[3.5rem_1fr] gap-3">
            <Line w="100%" show={writing} delay={i * 90} />
            <div className="space-y-2">
              <Line w="90%" show={writing} delay={i * 90 + 40} />
              <Line w="65%" show={writing} delay={i * 90 + 80} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      className="w-full max-w-[420px] rounded-2xl border border-border bg-surface-3 p-4 shadow-1"
      aria-hidden
    >
      <div className="flex items-center gap-2.5">
        <span className="size-9 rounded-full bg-surface-2" />
        <div className="flex-1 space-y-1.5">
          <Line w="40%" show />
          <Line w="24%" show />
        </div>
      </div>
      {session.type !== "carousel" ? (
        <div className="mt-4 space-y-2">
          <Line w="94%" show={writing} />
          <Line w="80%" show={writing} delay={90} />
          <Line w="52%" show={writing} delay={180} />
        </div>
      ) : null}
      {hasMedia || session.type === "carousel" ? (
        <div className="mt-4">
          <RatioFrame ratio={ratio} maxHeight={340} className="rounded-lg bg-surface-2">
            <Weave />
          </RatioFrame>
        </div>
      ) : null}
    </div>
  );
}
