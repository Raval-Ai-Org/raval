"use client";

import { Check, Play } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import Mox from "@/components/mox/Mox";
import { JOURNEY, NETWORKS, type SceneId } from "@/lib/platform";
import { scrollToY } from "@/lib/smooth-scroll";
import "./journey.css";

/* ------------------------------------------------------------------ */
/* Animated scenes. Pure CSS: they replay each time their card becomes */
/* active, and show their finished state when motion is reduced.       */
/* ------------------------------------------------------------------ */

const d = (s: number) => ({ "--d": `${s}s` }) as CSSProperties;

function WinBar({ title }: { title: string }) {
  return (
    <div className="sc-bar">
      <i />
      <i />
      <i />
      <span>{title}</span>
    </div>
  );
}

function SiteScene() {
  const chips = ["Voice", "Colours", "Offer", "Products", "Audience"];
  return (
    <div className="sc-win">
      <WinBar title="Brand DNA" />
      <div className="sc-body">
        <div className="sc-url">
          <span className="sc-globe" />
          <span className="sc-typed" style={{ ...d(0.3), "--ch": "15ch" } as CSSProperties}>
            yourbrand.com
          </span>
          <b className="sc-go rv" style={d(2)}>
            Scan
          </b>
        </div>
        <div className="sc-scan" aria-hidden="true" />
        <div className="sc-chips">
          {chips.map((c, i) => (
            <span key={c} className="sc-chip rv" style={d(2.3 + i * 0.28)}>
              {c}
            </span>
          ))}
        </div>
        <p className="sc-cap rv" style={d(3.8)}>
          Then, from the same scan:
        </p>
        {["Audience groups built", "Competitors found", "Market news collected"].map((t, i) => (
          <div key={t} className="sc-row rv" style={d(4.1 + i * 0.45)}>
            <span className="sc-tick">
              <Check size={12} strokeWidth={3} />
            </span>
            {t}
          </div>
        ))}
      </div>
    </div>
  );
}

function GoalScene() {
  return (
    <div className="sc-win">
      <WinBar title="Goal and products" />
      <div className="sc-body">
        <div className="sc-goal rv" style={d(0.2)}>
          <em>Your goal</em>
          <strong>10,000 views a month</strong>
          <span className="sc-bar-track">
            <u style={d(0.9)} />
          </span>
          <small>Counted from posts that really went out</small>
        </div>
        <p className="sc-cap rv" style={d(1.6)}>
          Products found on your site
        </p>
        <div className="sc-products">
          {[
            ["Starter kit", "#CBE960"],
            ["Glow serum", "#B489D1"],
            ["Travel set", "#FE7032"],
          ].map(([n, c], i) => (
            <div key={n} className="sc-product rv" style={d(1.9 + i * 0.4)}>
              <span style={{ background: `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 30%, #fff))` }} />
              <b>{n}</b>
              <small>Found</small>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BrainsScene() {
  const nodes = [
    { n: "Brand", c: "#CBE960", x: 12, y: 16 },
    { n: "Audience", c: "#0756E7", x: 88, y: 16 },
    { n: "Competitors", c: "#EE3445", x: 12, y: 84 },
    { n: "Market", c: "#FE7032", x: 88, y: 84 },
  ];
  return (
    <div className="sc-win">
      <WinBar title="Marketing strategy" />
      <div className="sc-body sc-brains">
        <svg className="sc-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {nodes.map((n, i) => (
            <line key={n.n} x1={n.x} y1={n.y} x2="50" y2="50" style={{ ...d(0.4 + i * 0.35), stroke: n.c }} pathLength={1} />
          ))}
        </svg>
        {nodes.map((n, i) => (
          <span key={n.n} className="sc-node rv" style={{ ...d(0.2 + i * 0.35), left: `${n.x}%`, top: `${n.y}%`, ["--nc" as string]: n.c }}>
            <i />
            {n.n}
          </span>
        ))}
        <div className="sc-strategy rv" style={d(2)}>
          <em>Your strategy</em>
          <u />
          <u />
          <u />
          <button type="button" tabIndex={-1} className="sc-confirm" style={d(3)}>
            <span className="a">Confirm</span>
            <span className="b">
              <Check size={13} strokeWidth={3} /> Confirmed
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function StudioScene() {
  const tiles = ["Post", "Carousel", "Ad", "Video", "Article"];
  return (
    <div className="sc-win">
      <WinBar title="Studio" />
      <div className="sc-body">
        <div className="sc-prompt">
          <span className="sc-typed" style={{ ...d(0.2), "--ch": "29ch" } as CSSProperties}>
            Launch post for our spring offer
          </span>
          <b className="sc-go rv" style={d(1.9)}>
            Generate
          </b>
        </div>
        <div className="sc-tiles">
          {tiles.map((t, i) => (
            <div key={t} className={`sc-tile t-${t.toLowerCase()} rv`} style={d(2.2 + i * 0.3)}>
              <div className="sc-art">
                {t === "Video" && (
                  <span className="sc-play">
                    <Play size={14} fill="currentColor" strokeWidth={0} />
                  </span>
                )}
                {t === "Carousel" && (
                  <>
                    <s />
                    <s />
                  </>
                )}
                {t === "Article" && (
                  <>
                    <u />
                    <u />
                    <u />
                  </>
                )}
              </div>
              <b>{t}</b>
            </div>
          ))}
        </div>
        <div className="sc-edit rv" style={d(4)}>
          <span>Make it warmer</span>
          <small>Edit chat · versions · undo</small>
        </div>
      </div>
    </div>
  );
}

function PublishScene() {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const posts: [number, number, string, string][] = [
    [0, 0, "Post", "#CBE960"],
    [1, 1, "Reel", "#B489D1"],
    [2, 0, "Carousel", "#0756E7"],
    [3, 2, "Post", "#CBE960"],
    [4, 1, "Ad", "#FE7032"],
    [5, 0, "Story", "#EE3445"],
  ];
  return (
    <div className="sc-win">
      <WinBar title="Calendar" />
      <div className="sc-body">
        <div className="sc-cal">
          {days.map((x) => (
            <span key={x} className="sc-day">
              {x}
            </span>
          ))}
          {posts.map(([c, r, t, col], i) => (
            <span
              key={`${c}${r}`}
              className="sc-post rv"
              style={{ ...d(0.4 + i * 0.35), gridColumn: c + 1, gridRow: r + 2, ["--pc" as string]: col }}
            >
              {t}
            </span>
          ))}
        </div>
        <div className="sc-approve rv" style={d(2.9)}>
          <span className="a">Waiting for approval</span>
          <span className="b">
            <Check size={12} strokeWidth={3} /> Approved and scheduled
          </span>
        </div>
        <div className="sc-nets">
          {NETWORKS.map((n, i) => (
            <span key={n.name} className="sc-net rv" style={d(3.4 + i * 0.18)} title={n.name}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/llms/${n.logo}.svg`} alt={n.name} width={20} height={20} loading="lazy" />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function AutopilotScene() {
  const rows = [
    ["Mon", "Product post", "Instagram"],
    ["Tue", "Reel", "TikTok"],
    ["Wed", "Carousel", "LinkedIn"],
    ["Thu", "Offer ad", "Facebook"],
    ["Fri", "Article", "Your blog"],
  ];
  return (
    <div className="sc-win">
      <WinBar title="Autopilot" />
      <div className="sc-body">
        <div className="sc-switch">
          <span className="sc-toggle" style={d(0.6)}>
            <i />
          </span>
          <b>
            Autopilot{" "}
            <span className="sw">
              <span className="off">off</span>
              <span className="on">on</span>
            </span>
          </b>
        </div>
        <div className="sc-plan">
          {rows.map(([day, what, where], i) => (
            <div key={day} className="sc-plan-row rv" style={d(1.4 + i * 0.45)}>
              <em>{day}</em>
              <span>{what}</span>
              <small>{where}</small>
              <span className="sc-tick">
                <Check size={11} strokeWidth={3} />
              </span>
            </div>
          ))}
        </div>
        <div className="sc-note rv" style={d(3.9)}>
          Weekly report sent · AI-visibility scan done
        </div>
      </div>
    </div>
  );
}

function ResultsScene() {
  const bars = [34, 48, 41, 66, 58, 86];
  return (
    <div className="sc-win">
      <WinBar title="Analytics · AI Visibility" />
      <div className="sc-body sc-results">
        <div className="sc-chart">
          {bars.map((h, i) => (
            <u key={i} style={{ ...d(0.3 + i * 0.12), ["--h" as string]: `${h}%` }} />
          ))}
        </div>
        <div className="sc-score rv" style={d(1.2)}>
          <svg viewBox="0 0 36 36" aria-hidden="true">
            <circle cx="18" cy="18" r="15.5" className="trk" />
            <circle cx="18" cy="18" r="15.5" className="fil" style={d(1.4)} pathLength={100} />
          </svg>
          <b>
            <span className="from">42</span>
            <span className="to">86</span>
          </b>
          <small>AI Visibility</small>
        </div>
        <div className="sc-q rv" style={d(2.6)}>
          What worked this week?
        </div>
        <div className="sc-a rv" style={d(3.3)}>
          Your Reels beat photos 2 to 1. Want more of them next week?
        </div>
      </div>
    </div>
  );
}

const SCENES: Record<SceneId, () => React.JSX.Element> = {
  site: SiteScene,
  goal: GoalScene,
  brains: BrainsScene,
  studio: StudioScene,
  publish: PublishScene,
  autopilot: AutopilotScene,
  results: ResultsScene,
};

/* ------------------------------------------------------------------ */

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const STICKY_TOP = 92;
const N = JOURNEY.length;

/**
 * Scroll-driven flow: one pinned stage that walks a brand from website to results, with Mox as the guide.
 * Each step is a card with an animated scene; a rail on top fills as you scroll and Mox's face rides along it.
 */
export default function MoxJourney({ title = "From your website to real results.", blurb = "Follow Mox through the whole of Mellox, one step at a time." }: { title?: string; blurb?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const markRef = useRef<HTMLSpanElement>(null);
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const targets = root.querySelectorAll<HTMLElement>("[data-reveal]");
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }),
      { threshold: 0.2 },
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let raf = 0;
    const seg = () => window.innerHeight * 0.8;

    const update = () => {
      raf = 0;
      const P = clamp((STICKY_TOP - wrap.getBoundingClientRect().top) / seg(), 0, N - 1);
      const f = P / (N - 1);
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${f})`;
      if (markRef.current) markRef.current.style.left = `${f * 100}%`;
      const a = Math.min(N - 1, Math.floor(P + 0.001));
      if (a !== activeRef.current) {
        activeRef.current = a;
        setActive(a);
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const goTo = (i: number) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    scrollToY(window.scrollY + wrap.getBoundingClientRect().top - STICKY_TOP + i * window.innerHeight * 0.8 + (i ? 6 : 0));
  };

  return (
    <section id="journey" ref={rootRef} className="jn" aria-labelledby="jn-title">
      <div className="jn-inner">
        <div className="jn-label" data-reveal>
          <Mox pose="face" height={34} decorative />
          <span>HOW MELLOX WORKS</span>
        </div>
        <div className="jn-rule" data-reveal />
        <div className="jn-head">
          <h2 id="jn-title" data-reveal>
            {title}
          </h2>
          <p data-reveal style={{ transitionDelay: "120ms" }}>
            {blurb}
          </p>
        </div>

        <div ref={wrapRef} className="jn-pin">
          <div className="jn-stage">
            <div className="jn-rail">
              <div className="jn-tabs" role="tablist" aria-label="Steps">
                {JOURNEY.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={i === active}
                    className={`jn-tab${i === active ? " is-active" : ""}${i < active ? " is-done" : ""}`}
                    onClick={() => goTo(i)}
                  >
                    <span className="n">{i < active ? <Check size={12} strokeWidth={3} /> : String(i + 1).padStart(2, "0")}</span>
                    <span className="t">{s.tab}</span>
                  </button>
                ))}
              </div>
              <div className="jn-track" aria-hidden="true">
                <span ref={fillRef} className="jn-fill" />
                <span ref={markRef} className="jn-mark">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/mox/cut/face.webp" alt="" width={30} height={33} />
                </span>
              </div>
            </div>

            <div className="jn-cards">
              {JOURNEY.map((s, i) => {
                const Scene = SCENES[s.id];
                return (
                  <article
                    key={s.id}
                    className={`jn-card ${i === active ? "is-active" : i < active ? "is-before" : "is-after"}`}
                    style={{ ["--sc" as string]: s.color }}
                    aria-hidden={i !== active}
                  >
                    <div className="jn-glow" aria-hidden="true" />
                    <div className="jn-copy">
                      <span className="jn-eyebrow">{s.eyebrow}</span>
                      <h3>{s.title}</h3>
                      <p>{s.text}</p>
                      <ul>
                        {s.points.map((pt, k) => (
                          <li key={pt} style={{ transitionDelay: `${0.25 + k * 0.1}s` }}>
                            <span className="tick">
                              <Check size={13} strokeWidth={2.6} />
                            </span>
                            {pt}
                          </li>
                        ))}
                      </ul>
                      <div className="jn-guide">
                        <Mox pose={s.pose} height={132} float />
                        <p className="jn-say">{s.say}</p>
                      </div>
                    </div>
                    <div className="jn-scene" aria-hidden="true">
                      <Scene />
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
