"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { CITY_COUNT, MAP_VIEW, mapDots, place } from "@/marketing/lib/us-dot-map";
import "./customer-map.css";

/**
 * Customers on a map of the United States made of dots. Each customer is a pin with their picture.
 *
 * The dots are drawn on a canvas and never sit still (one rAF loop, asleep while the map is off screen):
 *  - the colour sweeps in from the left over the grey dots when the map scrolls into view
 *  - every big city breathes at its own pace, a soft band of light keeps crossing the country, and every dot
 *    flickers a little on its own timing; a brighter dot is also a slightly bigger one
 *  - a pin that pops up sends a ring of light out through the dots around it
 * The pins pop up one after another, and from then on one at a time fades away and pops back.
 */

const DOTS = mapDots();

const photo = (id: string) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&crop=faces&w=160&h=160&q=80`;

const person = (name: string, id: string, lon: number, lat: number) => {
  const at = place(lon, lat);
  return {
    name,
    img: photo(id),
    at,
    left: ((at.x - MAP_VIEW.x) / MAP_VIEW.w) * 100,
    top: ((at.y - MAP_VIEW.y) / MAP_VIEW.h) * 100,
  };
};

// Sample content: placeholder people. Photos are from Unsplash.
const people = [
  person("Priya Nair", "1573496359142-b8d87734a5a2", -74.0, 40.7),
  person("Daniel Brooks", "1560250097-0b93528c311a", -118.2, 34.0),
  person("Sofia Alvarez", "1494790108377-be9c29b29330", -97.7, 30.3),
  person("Marcus Hale", "1519085360753-af0119f7cbe7", -87.6, 41.9),
  person("Hannah Cole", "1581065178047-8ee15951ede6", -105.0, 39.7),
  person("Omar Rahman", "1500648767791-00dcc994a43e", -80.2, 25.8),
];

const FIRST = 250; // ms before the first pin, so the colour lands first
const STEP = 120; // ms between pins as they first appear
const EVERY = 1300; // ms between one pin leaving and the next
const AWAY = 450; // ms a pin stays away before it pops back
// the order pins leave in: never two neighbours in a row
const ORDER = [2, 0, 4, 1, 5, 3];

const SWEEP = 0.55; // seconds for the colour to cross the map
const RING_SPEED = 20; // dots a second a pin's ring travels
const RING_LIFE = 1.1; // seconds it lasts

// Brightness steps, dimmest first: dim olive up to Mellox lime, and a paler lime for the very brightest.
const STEPS = 18;
const COLOURS = Array.from({ length: STEPS }, (_, i) => {
  const t = i / (STEPS - 1);
  const mix = (a: number, b: number, k: number) => Math.round(a + (b - a) * k);
  if (t <= 0.8) {
    const k = t / 0.8;
    return `rgb(${mix(38, 203, k)},${mix(46, 233, k)},${mix(29, 96, k)})`;
  }
  const k = (t - 0.8) / 0.2;
  return `rgb(${mix(203, 238, k)},${mix(233, 255, k)},${mix(96, 176, k)})`;
});

type Pin = { on: boolean; run: number };
type Ring = { x: number; y: number; born: number };

export default function CustomerMap() {
  const ref = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pins, setPins] = useState<Pin[]>(() => people.map(() => ({ on: false, run: 0 })));

  useEffect(() => {
    const el = ref.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!el || !canvas || !ctx) return;

    let inView = false;
    let started = 0; // when the colour began to sweep in (seconds), 0 until then
    let turn = 0;
    let raf = 0;
    let scale = 1; // canvas pixels per map unit
    const rings: Ring[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    let loop: ReturnType<typeof setInterval> | undefined;
    const now = () => performance.now() / 1000;

    // each city breathes on its own timing
    const cityPhase = Array.from({ length: CITY_COUNT }, (_, k) => k * 2.399);
    const citySpeed = Array.from({ length: CITY_COUNT }, (_, k) => 1.9 + (k % 4) * 0.45);
    // dots of one brightness are drawn in one go
    const buckets: number[][] = Array.from({ length: STEPS }, () => []);

    const size = () => {
      const w = canvas.clientWidth;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(((w * MAP_VIEW.h) / MAP_VIEW.w) * dpr);
      scale = canvas.width / MAP_VIEW.w;
    };

    const draw = () => {
      const t = now();
      const age = started ? t - started : 0;
      // how far across the colour has come, in map units (with a soft front 9 units deep)
      const front = started ? Math.min(1, age / SWEEP) * (MAP_VIEW.w + 9) + MAP_VIEW.x : -99;
      while (rings.length && t - rings[0].born > RING_LIFE) rings.shift();
      buckets.forEach((b) => (b.length = 0));

      ctx.setTransform(scale, 0, 0, scale, -MAP_VIEW.x * scale, -MAP_VIEW.y * scale);
      ctx.clearRect(MAP_VIEW.x, MAP_VIEW.y, MAP_VIEW.w, MAP_VIEW.h);

      // grey dots: the map is there before the colour arrives
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      ctx.beginPath();
      for (let i = 0; i < DOTS.length; i++) {
        const d = DOTS[i];
        const seen = Math.min(1, Math.max(0, (front - d.x) / 9));
        if (seen <= 0) {
          ctx.moveTo(d.x + 0.25, d.y);
          ctx.arc(d.x, d.y, 0.25, 0, 6.2832);
          continue;
        }
        const breathe = 0.62 + 0.38 * Math.sin(t * citySpeed[d.city] + cityPhase[d.city]);
        const band = Math.max(0, Math.sin(d.x * 0.22 + d.y * 0.13 - t * 2.6)) ** 6;
        const flicker = 0.5 + 0.5 * Math.sin(t * (2.2 + d.grain * 5) + d.grain * 50);
        let heat = 0.07 + d.glow * breathe * 0.92 + band * 0.22 + flicker * 0.09;
        for (const r of rings) {
          const life = (t - r.born) / RING_LIFE;
          const gap = Math.hypot(d.x - r.x, d.y - r.y) - (t - r.born) * RING_SPEED;
          heat += Math.exp(-(gap * gap) / 2.4) * (1 - life) * 0.75;
        }
        buckets[Math.min(STEPS - 1, Math.max(0, Math.floor(heat * seen * STEPS)))].push(i);
      }
      ctx.fill();

      buckets.forEach((b, step) => {
        if (!b.length) return;
        const r = 0.25 + 0.1 * (step / (STEPS - 1)); // a brighter dot is a slightly bigger one
        ctx.fillStyle = COLOURS[step];
        ctx.beginPath();
        for (const i of b) {
          const d = DOTS[i];
          ctx.moveTo(d.x + r, d.y);
          ctx.arc(d.x, d.y, r, 0, 6.2832);
        }
        ctx.fill();
      });
    };

    // thirty pictures a second is plenty for light that drifts, and leaves the page free to scroll
    let drawn = 0;
    const frame = (at: number) => {
      if (at - drawn >= 30) {
        drawn = at;
        draw();
      }
      raf = inView ? requestAnimationFrame(frame) : 0;
    };
    const wake = () => {
      if (!raf && inView) raf = requestAnimationFrame(frame);
    };

    const show = (i: number) => {
      rings.push({ ...people[i].at, born: now() });
      setPins((p) => p.map((pin, k) => (k === i ? { on: true, run: pin.run + 1 } : pin)));
    };
    const hide = (i: number) => setPins((p) => p.map((pin, k) => (k === i ? { ...pin, on: false } : pin)));

    const start = () => {
      started = now();
      people.forEach((_, i) => timers.push(setTimeout(() => show(i), FIRST + i * STEP)));
      timers.push(
        setTimeout(
          () => {
            loop = setInterval(() => {
              if (!inView) return;
              const i = ORDER[turn++ % ORDER.length];
              hide(i);
              timers.push(setTimeout(() => show(i), AWAY));
            }, EVERY);
          },
          FIRST + people.length * STEP,
        ),
      );
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting;
        if (inView && !started && entry.intersectionRatio >= 0.2) start();
        wake();
      },
      { threshold: [0, 0.2] },
    );
    const ro = new ResizeObserver(() => {
      size();
      draw();
    });

    size();
    draw();
    io.observe(el);
    ro.observe(canvas);
    return () => {
      io.disconnect();
      ro.disconnect();
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      clearInterval(loop);
    };
  }, []);

  return (
    <section id="testimonials" ref={ref} className="cm">
      <div className="cm-head">
        <h2>Trusted by customers</h2>
        <p>Proven outcomes shared by marketers, founders and agencies using Mellox.</p>
      </div>

      <div className="cm-map">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="A map of the United States made of dots, brightest around the big cities"
        />

        <div className="cm-pins" aria-hidden="true">
          {people.map((p, i) => (
            <div
              key={p.name}
              className="cm-pin"
              style={{ left: `${p.left}%`, top: `${p.top}%`, opacity: pins[i].on ? 1 : 0 }}
            >
              {pins[i].run > 0 && (
                // a new key each time it comes back, so it pops again
                <div key={pins[i].run} className="cm-pin-pop">
                  <Image src={p.img} alt="" width={44} height={44} draggable={false} />
                  <i />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* the top of the map melts into the page, so the heading reads cleanly over it */}
        <div className="cm-fade" aria-hidden="true" />
      </div>
    </section>
  );
}
