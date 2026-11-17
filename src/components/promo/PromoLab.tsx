"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { DURATION, SCENES, STAGE } from "@/lib/promo/timeline";
import { MOX_DURATION, MOX_SCENES } from "@/lib/promo/mox-timeline";
import { PromoFilm } from "./PromoFilm";
import { MoxFilm } from "./mox/MoxFilm";
import { MOX_MARK_SRC } from "./mox/parts";
import { MARK_SRC } from "./parts";

export type PromoFilmId = "tour" | "mox";

declare global {
  interface Window {
    /** Recorder hook: draw the film at `t` seconds and wait until it is painted. */
    __promoSeek?: (t: number) => Promise<boolean>;
  }
}

/**
 * Plays a product film in the browser (`tour`, the 40-second one, or `mox`,
 * the 107-second "Meet Mox"). With `record` there are no controls and the
 * clock only moves when the recorder asks (`window.__promoSeek`).
 */
export function PromoLab({
  record,
  site,
  film = "tour",
}: {
  record: boolean;
  site: string;
  film?: PromoFilmId;
}) {
  const mox = film === "mox";
  const duration = mox ? MOX_DURATION : DURATION;
  const scenes = mox ? MOX_SCENES : SCENES;
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(!record);
  const [scale, setScale] = useState(1);
  const clock = useRef(0);

  useEffect(() => {
    const fit = () => {
      const room = record ? 0 : 64;
      setScale(
        Math.min(window.innerWidth / STAGE.width, (window.innerHeight - room) / STAGE.height),
      );
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [record]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      clock.current = (clock.current + (now - last) / 1000) % duration;
      last = now;
      setT(clock.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, duration]);

  useEffect(() => {
    if (!record) return;
    window.__promoSeek = async (time: number) => {
      clock.current = time;
      flushSync(() => setT(time));
      await document.fonts.ready;
      // Footage is drawn as numbered stills: wait for this frame's pictures.
      await Promise.all(
        Array.from(document.images, (image) =>
          image.complete && image.naturalWidth > 0 ? null : image.decode().catch(() => null),
        ),
      );
      await new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      );
      return true;
    };
    return () => {
      delete window.__promoSeek;
    };
  }, [record]);

  const seek = useCallback((time: number) => {
    clock.current = time;
    setT(time);
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: record ? (mox ? "#FFFFFF" : "#FAFAF8") : "#111214",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {/* Loaded up front so no scene ever draws a frame without its mark. */}
      <img
        src={mox ? MOX_MARK_SRC : MARK_SRC}
        alt=""
        style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
      />
      <div style={{ width: STAGE.width * scale, height: STAGE.height * scale, flexShrink: 0 }}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0" }}>
          {mox ? <MoxFilm t={t} site={site} /> : <PromoFilm t={t} site={site} />}
        </div>
      </div>
      {record ? null : (
        <div
          style={{
            height: 64,
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "0 20px",
            color: "#fff",
            fontSize: 14,
          }}
        >
          <button
            type="button"
            onClick={() => setPlaying((value) => !value)}
            style={{
              padding: "8px 18px",
              borderRadius: 999,
              background: "#D4E85C",
              color: "#0B0C0E",
              fontWeight: 600,
            }}
          >
            {playing ? "Pause" : "Play"}
          </button>
          <input
            type="range"
            min={0}
            max={duration}
            step={1 / 30}
            value={t}
            onChange={(event) => {
              setPlaying(false);
              seek(Number(event.target.value));
            }}
            style={{ flex: 1 }}
            aria-label="Time"
          />
          <span style={{ width: 150, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            {t.toFixed(2)}s ·{" "}
            {scenes.find((scene) => t >= scene.start && t < scene.end)?.id ?? "end"}
          </span>
        </div>
      )}
    </div>
  );
}
