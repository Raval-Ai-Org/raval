"use client";

// /motionmox-lab (development only): the MotionMox composition played in the
// browser with @motionmox/player and sample data, in every ratio and with any
// set of elements, before anything is rendered.
import { useEffect, useMemo, useState } from "react";
import { Player } from "@motionmox/player";
import { cn } from "@/lib/utils";
import { MotionMoxVideo } from "@/lib/studio/motionmox/compositions/MotionMoxVideo";
import { SAMPLE_SPEC, sampleAt } from "@/lib/studio/motionmox/compositions/sample";
import { MOTIONMOX_ELEMENTS, type MotionMoxElementId } from "@/lib/studio/motionmox/elements";
import { specFrames, type MotionMoxSpec } from "@/lib/studio/motionmox/spec";
import { videoCanvas } from "@/lib/studio/clip-edit";
import type { AspectRatio } from "@/lib/studio/aspect";

const RATIOS: AspectRatio[] = ["9:16", "4:5", "1:1", "16:9"];
const TEXT_ELEMENTS = [...new Set(SAMPLE_SPEC.texts.map((t) => t.element))];

/** `?frame=<n>` holds the player still on one frame (visual checks); `?ratio=1:1` picks the ratio. */
function fromQuery(): { frame: number | null; ratio: AspectRatio | null } {
  if (typeof window === "undefined") return { frame: null, ratio: null };
  const q = new URLSearchParams(window.location.search);
  const frame = Number(q.get("frame"));
  const ratio = q.get("ratio") as AspectRatio | null;
  return {
    frame: q.has("frame") && Number.isFinite(frame) && frame >= 0 ? Math.round(frame) : null,
    ratio: ratio && RATIOS.includes(ratio) ? ratio : null,
  };
}

export function MotionMoxLab() {
  // Read after mount, so the server's HTML and the first client render agree.
  const [query, setQuery] = useState<ReturnType<typeof fromQuery>>({ frame: null, ratio: null });
  const [ratio, setRatio] = useState<AspectRatio>("9:16");
  useEffect(() => {
    const q = fromQuery();
    setQuery(q);
    if (q.ratio) setRatio(q.ratio);
  }, []);
  const [off, setOff] = useState<Set<MotionMoxElementId>>(new Set());
  const [captions, setCaptions] = useState(true);
  const [bar, setBar] = useState(true);

  const spec: MotionMoxSpec = useMemo(() => {
    const { width, height } = videoCanvas(ratio);
    const base = sampleAt(width, height);
    return {
      ...base,
      texts: base.texts.filter((t) => !off.has(t.element)),
      captions: captions ? base.captions : [],
      progressBar: bar,
    };
  }, [ratio, off, captions, bar]);

  const toggle = (id: MotionMoxElementId) =>
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const pill = (on: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-xs font-medium",
      on
        ? "border-primary-border bg-primary text-primary-foreground"
        : "border-border bg-surface-2 text-muted-foreground",
    );

  return (
    <main className="mx-auto max-w-5xl space-y-5 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">MotionMox lab</h1>
        <p className="text-sm text-muted-foreground">
          The composition Mellox renders, played live with sample data. Nothing is rendered or
          charged here.
        </p>
      </header>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Ratio">
        {RATIOS.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={ratio === r}
            className={pill(ratio === r)}
            onClick={() => setRatio(r)}
          >
            {r}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Elements">
        {TEXT_ELEMENTS.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={!off.has(id)}
            className={pill(!off.has(id))}
            onClick={() => toggle(id)}
          >
            {MOTIONMOX_ELEMENTS[id].label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={captions}
          className={pill(captions)}
          onClick={() => setCaptions((v) => !v)}
        >
          Captions
        </button>
        <button
          type="button"
          aria-pressed={bar}
          className={pill(bar)}
          onClick={() => setBar((v) => !v)}
        >
          Progress bar
        </button>
      </div>
      <div className="flex justify-center rounded-2xl border border-border bg-surface-3 p-4">
        <Player
          key={`${ratio}:${query.frame ?? "play"}`}
          data-testid="motionmox-player"
          component={MotionMoxVideo}
          inputProps={{ spec, baseUrl: "" }}
          durationInFrames={specFrames(spec)}
          compositionWidth={spec.width}
          compositionHeight={spec.height}
          fps={spec.fps}
          controls
          loop
          autoPlay={query.frame === null}
          initialFrame={query.frame === null ? 0 : Math.min(query.frame, specFrames(spec) - 1)}
          acknowledgeRemotionLicense
          style={{
            width: spec.width >= spec.height ? 640 : 360,
            maxWidth: "100%",
            aspectRatio: `${spec.width} / ${spec.height}`,
          }}
        />
      </div>
    </main>
  );
}
