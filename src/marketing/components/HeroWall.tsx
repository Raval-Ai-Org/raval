"use client";

import { useEffect, useRef } from "react";
import { WALL, type WallItem } from "@/marketing/lib/hero-wall";
import "./hero-wall.css";

/**
 * The arc under the home hero: a curved wall of content made with Mellox (videos that play, picture posts that
 * slide), seen from inside the curve, so the cards at the edges come towards you and the ones in the middle sit
 * further back.
 *
 * Motion (one rAF loop, which sleeps while the wall is off screen):
 *  - the cards travel round the arc without stopping; a card that leaves one side comes back on the other
 *  - scrolling pushes them faster for a moment, then they settle back to their own pace; the push is eased in
 *    and out, so a turn of the wheel never jolts the wall
 *  - scrolling also opens the arc out and lifts it (--p, 0..1, eased), and hands the same value to the hero above
 *    as --hero-rv, so the copy eases back as the wall comes forward
 *
 * Only the cards you can see are playing: a clip starts as it comes round and pauses as it leaves, and a picture
 * post only slides through its pictures while it is in view. A card that is about to come round gets its clip or
 * its later pictures ready first, so it arrives already drawn.
 * Kept cheap, because it runs over the hero's moving sky: each frame writes one transform per card and nothing
 * else unless a value really changed, and the cards fade out towards the sides by their own opacity instead of a
 * mask over the whole wall.
 *
 * Decoration: hidden from assistive technology, with one sentence that says what it shows.
 */

const STEP = 18; // degrees between neighbours
const SPAN = WALL.length * STEP; // the arc the cards are spread over; a card wraps at ±SPAN/2
const DRIFT = 6; // degrees a second: the wall's own pace
const PLAY_WITHIN = 62; // a clip plays while it is within this many degrees of the middle
const HIDE_BEYOND = 80; // past this a card is far off the side of the screen, so it isn't drawn at all
const FADE = 13; // degrees over which a card fades out as it nears the side of the screen
const HOLD = 2.2; // seconds a picture post rests on each picture

export default function HeroWall() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    const slot = el?.parentElement; // untransformed wrapper, used to measure scroll progress
    if (!el || !slot) return;
    const hero = slot.previousElementSibling as HTMLElement | null;
    // the two parts of the hero that answer the wall's arrival; written to directly, so the rest of the hero is
    // never restyled while you scroll
    const followers = hero ? Array.from(hero.querySelectorAll<HTMLElement>(".hero-copy, .hero-arc")) : [];
    const slots = Array.from(el.querySelectorAll<HTMLElement>(".hw-slot"));
    const videos = slots.map((s) => s.querySelector("video"));
    // a phone only lets a clip start by itself if it is silent; the attribute alone isn't always enough
    videos.forEach((v) => v && (v.muted = true));
    const firstCard = el.querySelector<HTMLElement>(".hw-card");
    // the picture posts: which picture each is on, and how long until it moves on (staggered, so they never all
    // slide at once)
    const posts = slots.map((s, i) => {
      const track = s.querySelector<HTMLElement>(".hw-track");
      if (!track) return null;
      const dots = Array.from(s.querySelectorAll<HTMLElement>(".hw-count i"));
      return { track, dots, at: 0, wait: HOLD * (0.45 + ((i * 0.37) % 1) * 0.55) };
    });
    const near = slots.map(() => false);
    const hidden = slots.map(() => false);
    const ready = slots.map(() => false);
    const shade = slots.map(() => "");
    let fadeEnd = HIDE_BEYOND; // the angle at which a card has reached the side of the screen
    let phone = false;
    let shown = "";

    let angle = 0; // how far the wall has travelled
    let push = 0; // what scrolling asks for, in degrees a second
    let boost = 0; // the extra speed the wall really has: it follows `push` softly
    let target = 0;
    let current = 0;
    let raf = 0;
    let last = 0;
    let lastY = window.scrollY;
    let onScreen = true;
    // slow at both ends, so the movement starts and lands softly instead of tracking the wheel 1:1
    const ease = (p: number) => p * p * (3 - 2 * p);

    const measure = () => {
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      phone = vw <= 760;
      // Where the side of the screen falls on the arc, from the same numbers as hero-wall.css (in units of --u, and
      // a card is 18 of them wide): radius 60, eye 62 away, centre pulled 30 towards it. A phone shows whole cards
      // up to its edge, so no fade.
      const half = vw / 2 / ((firstCard?.offsetWidth || vw * 0.18) / 18);
      fadeEnd = HIDE_BEYOND - 2;
      for (let a = 30; a < HIDE_BEYOND - 2; a++) {
        const r = (a * Math.PI) / 180;
        if ((60 * Math.sin(r) * 62) / (32 + 60 * Math.cos(r)) >= half) {
          fadeEnd = a + 1;
          break;
        }
      }
      const box = slot.getBoundingClientRect();
      onScreen = box.bottom > -80 && box.top < vh + 80;
      // 0 while the wall's top is near the bottom of the screen, 1 once it has risen to a fifth of the way down
      target = Math.min(1, Math.max(0, (vh * 0.92 - box.top) / (vh * 0.72)));
    };

    const place = () => {
      slots.forEach((s, i) => {
        // this card's place on the arc, wrapped so the row never ends
        let a = (i - (slots.length - 1) / 2) * STEP - angle;
        a = ((((a + SPAN / 2) % SPAN) + SPAN) % SPAN) - SPAN / 2;
        s.style.transform = `rotateY(${a.toFixed(3)}deg) translateZ(calc(var(--R) * -1))`;
        const far = Math.abs(a) > HIDE_BEYOND;
        const o = phone ? "" : Math.min(1, Math.max(0, (fadeEnd - Math.abs(a)) / FADE)).toFixed(2);
        if (o !== shade[i]) {
          shade[i] = o;
          s.style.opacity = o;
        }
        if (far !== hidden[i]) {
          hidden[i] = far;
          s.style.visibility = far ? "hidden" : "";
        }
        // just before a card comes round, fetch what it will show
        if (!far && !ready[i] && onScreen) {
          ready[i] = true;
          if (videos[i]) videos[i]!.preload = "auto";
          s.querySelectorAll<HTMLImageElement>("img[data-src]").forEach((img) => {
            img.src = img.dataset.src!;
          });
        }
        // a phone shows fewer cards, so fewer need to be playing
        const visible = onScreen && Math.abs(a) < (phone ? 40 : Math.min(PLAY_WITHIN, fadeEnd));
        near[i] = visible;
        const v = videos[i];
        if (!v) return;
        if (visible && v.paused) void v.play().catch(() => {});
        else if (!visible && !v.paused) v.pause();
      });
    };

    // move the picture posts in view on to their next picture
    const slide = (dt: number) => {
      posts.forEach((p, i) => {
        if (!p || !near[i]) return;
        p.wait -= dt;
        if (p.wait > 0) return;
        p.wait = HOLD;
        const n = p.dots.length;
        if (p.at >= n) {
          // it is resting on the copy of the first picture: jump back to the real one, unseen, then carry on
          p.track.style.transition = "none";
          p.track.style.transform = "translateX(0)";
          void p.track.offsetWidth;
          p.track.style.transition = "";
          p.at = 0;
        }
        p.at += 1;
        p.track.style.transform = `translateX(${-p.at * 100}%)`;
        p.dots.forEach((d, k) => d.classList.toggle("is-on", k === p.at % n));
      });
    };

    const frame = (now: number) => {
      // real time, so the wall keeps its pace on a slow machine too (capped, so a paused tab doesn't leap)
      const dt = Math.min(0.25,(now - last) / 1000 || 0.016);
      last = now;
      angle += (DRIFT + boost) * dt;
      boost += (push - boost) * (1 - Math.exp(-dt / 0.14));
      push *= Math.exp(-dt / 0.55); // the push from scrolling fades in about a second
      current += (target - current) * (1 - Math.exp(-dt / 0.16));
      const v = ease(current).toFixed(4);
      if (v !== shown) {
        shown = v;
        el.style.setProperty("--p", v);
        followers.forEach((f) => f.style.setProperty("--hero-rv", v));
      }
      place();
      slide(dt);
      raf = onScreen ? requestAnimationFrame(frame) : 0;
    };
    const wake = () => {
      if (!raf && onScreen) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };

    const onScroll = () => {
      const y = window.scrollY;
      // scrolling down sends the cards on faster; scrolling up sends them back
      push = Math.max(-48, Math.min(48, push + (y - lastY) * 0.2));
      lastY = y;
      measure();
      if (!onScreen) place(); // pause the clips once it has left the screen
      wake();
    };

    measure();
    current = target;
    place();
    wake();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={ref} className="hw">
      <span className="sr-only">
        Content made with Mellox, playing by itself: short vertical videos and picture posts that slide through their
        pictures.
      </span>
      <div className="hw-turn" aria-hidden="true">
        {WALL.map((item, i) => (
          // the starting place, so the arc is already laid out before the loop takes over
          <div
            key={i}
            className="hw-slot"
            style={{ "--a": `${(i - (WALL.length - 1) / 2) * STEP}deg` } as React.CSSProperties}
          >
            <Card item={item} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Card({ item }: { item: WallItem }) {
  if (item.kind === "carousel") {
    // the first picture is repeated at the end, so the slide back to the start is one more step forward
    const loop = [...item.slides, item.slides[0]];
    return (
      <div className="hw-card hw-carousel" style={{ aspectRatio: item.ratio }}>
        <div className="hw-track">
          {loop.map((src, i) =>
            // only the first picture is fetched up front; HeroWall asks for the rest when the card comes into view
            i === 0 ? <img key={i} src={src} alt="" /> : <img key={i} data-src={src} alt="" />,
          )}
        </div>
        <span className="hw-count">
          {item.slides.map((_, i) => (
            <i key={i} className={i === 0 ? "is-on" : undefined} />
          ))}
        </span>
      </div>
    );
  }
  return (
    <div className="hw-card">
      <video
        className="hw-media"
        src={item.src}
        poster={item.poster}
        muted
        loop
        playsInline
        preload="none"
        disablePictureInPicture
      />
    </div>
  );
}
