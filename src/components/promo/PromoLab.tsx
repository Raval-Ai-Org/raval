"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { DURATION, SCENES, STAGE } from "@/lib/promo/timeline";
import { PromoFilm } from "./PromoFilm";
import { MARK_SRC } from "./parts";

declare global {
  interface Window {
    /** Recorder hook: draw the film at `t` seconds and wait until it is painted. */
    __promoSeek?: (t: number) => Promise<boolean>;
  }
}

/**
 * Plays the product film in the browser. With `record` there are no controls
 * and the clock only moves when the recorder asks (`window.__promoSeek`).
 */
export function PromoLab({ record, site }: { record: boolean; site: string }) {
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
      clock.current = (clock.current + (now - last) / 1000) % DURATION;
      last = now;
      setT(clock.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  useEffect(() => {
    if (!record) return;
    window.__promoSeek = async (time: number) => {
      clock.current = time;
      flushSync(() => setT(time));
      await document.fonts.ready;
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
        background: record ? "#FAFAF8" : "#111214",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {/* Loaded up front so no scene ever draws a frame without its mark. */}
      <img
        src={MARK_SRC}
        alt=""
        style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
      />
      <div style={{ width: STAGE.width * scale, height: STAGE.height * scale, flexShrink: 0 }}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0" }}>
          <PromoFilm t={t} site={site} />
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
            max={DURATION}
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
            {SCENES.find((scene) => t >= scene.start && t < scene.end)?.id ?? "outro"}
          </span>
        </div>
      )}
    </div>
  );
}
