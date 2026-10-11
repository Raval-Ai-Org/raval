import type { CSSProperties } from "react";
import { BrandLogo, type BrandKey } from "@/components/brand/BrandLogo";
import { easeInOut, easeOutBack, lerp, move, progress, typed } from "@/lib/promo/timeline";
import { AppStrip, PANEL } from "./panels";
import {
  Badge,
  C,
  Card,
  Chip,
  Glyph,
  type GlyphName,
  Lines,
  Mark,
  Tile,
  Typing,
  Words,
  sentence,
} from "./parts";

/** The first five scenes of the film: the promise, the name, and the app. */

export type SceneProps = { lt: number; len: number };

const row: CSSProperties = { position: "absolute", left: 0, right: 0, textAlign: "center" };

const CHANNELS: BrandKey[] = [
  "linkedin",
  "instagram",
  "x",
  "tiktok",
  "youtube",
  "reddit",
  "google",
];

export function HookScene({ lt }: SceneProps) {
  const first = 1 - progress(lt, 0.52, 0.18);
  const second = move(lt, 0.68, 0.3);
  const slide = lerp(90, -90, progress(lt, 0.68, 1.92));
  const underline = easeInOut(progress(lt, 1.5, 0.45));
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: 210,
          top: 130,
          opacity: 0.05,
          transform: `scale(${lerp(1.22, 1, progress(lt, 0, 2.6)).toFixed(4)})`,
        }}
      >
        <Mark width={1500} />
      </div>

      <div style={{ ...row, top: 440, opacity: first }}>
        <Words
          lt={lt}
          size={170}
          words={[
            { text: "This", at: 0.03 },
            { text: "AI", at: 0.17 },
          ]}
        />
      </div>

      <div style={{ position: "absolute", inset: 0, opacity: second }}>
        <div style={{ ...row, top: 230 }}>
          <Words lt={lt} size={76} words={sentence("will run your", 0.7, 0.09)} />
        </div>
        <div
          style={{
            position: "absolute",
            top: 390,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
            gap: 38,
            transform: `translateX(${slide.toFixed(2)}px)`,
          }}
        >
          {CHANNELS.map((name, index) => {
            const pop = move(lt, 0.78 + index * 0.06, 0.35);
            return (
              <Tile
                key={name}
                size={116}
                style={{ opacity: pop, transform: `scale(${lerp(0.7, 1, pop).toFixed(4)})` }}
              >
                <BrandLogo name={name} brand size={56} />
              </Tile>
            );
          })}
        </div>
        <div style={{ ...row, top: 590 }}>
          <div style={{ display: "inline-block", position: "relative" }}>
            <svg
              viewBox="0 0 600 40"
              preserveAspectRatio="none"
              style={{ position: "absolute", right: -10, bottom: -8, width: "62%", height: 44 }}
              aria-hidden="true"
            >
              <path
                d="M6 26 C 120 6, 260 34, 380 18 S 560 12, 594 22"
                fill="none"
                stroke={C.lime}
                strokeWidth={16}
                strokeLinecap="round"
                pathLength={1}
                strokeDasharray={1}
                strokeDashoffset={1 - underline}
              />
            </svg>
            <Words
              lt={lt}
              size={164}
              style={{ position: "relative" }}
              words={[
                { text: "entire", at: 1.05 },
                { text: "marketing", at: 1.25 },
              ]}
            />
          </div>
        </div>
      </div>
    </>
  );
}

type Floating = {
  left: number;
  top: number;
  width: number;
  title: string;
  chip: string;
  tone?: "moss" | "amber";
};

const FLOATING: Floating[] = [
  { left: 60, top: 60, width: 350, title: "LinkedIn post", chip: "Posted" },
  { left: 785, top: -36, width: 350, title: "Brand DNA", chip: "Learned" },
  { left: 1500, top: 70, width: 360, title: "AI Visibility", chip: "Fixed" },
  { left: 14, top: 470, width: 300, title: "Carousel", chip: "Approved" },
  { left: 1606, top: 450, width: 300, title: "Article", chip: "Published" },
  { left: 90, top: 800, width: 350, title: "Instagram", chip: "Posted" },
  { left: 785, top: 900, width: 350, title: "Weekly plan", chip: "Ready" },
  { left: 1480, top: 800, width: 360, title: "Competitors", chip: "2 updates", tone: "amber" },
];

export function RevealScene({ lt }: SceneProps) {
  const sharpen = move(lt, 0.45, 0.9);
  const lift = move(lt, 0.75, 0.6);
  const mark = easeOutBack(progress(lt, 0, 0.55));
  return (
    <>
      {FLOATING.map((card, index) => {
        const toCentreX = (960 - (card.left + card.width / 2)) * 0.06 * (1 - sharpen);
        const toCentreY = (540 - (card.top + 110)) * 0.06 * (1 - sharpen);
        const float = Math.sin(lt * 0.9 + index * 1.7) * 7;
        const blur = (1 - sharpen) * 14;
        return (
          <Card
            key={card.title}
            style={{
              left: card.left,
              top: card.top,
              width: card.width,
              height: 224,
              padding: 22,
              opacity: lerp(0.28, 1, sharpen),
              filter: blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : undefined,
              transform: `translate(${toCentreX.toFixed(2)}px, ${(toCentreY + float).toFixed(2)}px)`,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 22,
              }}
            >
              <span style={{ fontSize: 22, fontWeight: 600, color: C.ink }}>{card.title}</span>
              <Chip label={card.chip} tone={card.tone ?? "moss"} size={17} />
            </div>
            <div style={{ height: 62, borderRadius: 12, background: C.wash, marginBottom: 18 }} />
            <Lines widths={[94, 66]} height={11} />
          </Card>
        );
      })}

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: lerp(470, 300, lift),
          display: "flex",
          justifyContent: "center",
          opacity: progress(lt, 0, 0.25),
          transform: `scale(${(lerp(0.6, 1, mark) * lerp(1, 0.8, lift)).toFixed(4)})`,
        }}
      >
        <Mark width={260} />
      </div>
      <div
        style={{
          ...row,
          top: 470,
          fontFamily: "var(--font-brand)",
          fontSize: 58,
          color: C.ink,
          opacity: move(lt, 0.9, 0.4),
        }}
      >
        Mellox<span style={{ marginLeft: "0.28em", color: C.moss }}>AI</span>
      </div>
      <div style={{ ...row, top: 580 }}>
        <Words lt={lt} size={124} words={sentence("Your AI marketing team", 1.1, 0.12)} />
      </div>
    </>
  );
}

const SITE = "yourwebsite.com";

export function WebsiteScene({ lt }: SceneProps) {
  const push = easeInOut(progress(lt, 0.9, 0.5));
  const ask = 1 - progress(lt, 1.0, 0.3);
  const bar = move(lt, 1.1, 0.4);
  const typing = progress(lt, 1.4, 0.75);
  return (
    <>
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: ask,
          transform: `scale(${lerp(1, 1.5, push).toFixed(4)})`,
          transformOrigin: "50% 58%",
        }}
      >
        <div style={{ ...row, top: 360 }}>
          <Words lt={lt} size={104} words={sentence("Just drop in your website", 0.05, 0.11)} />
        </div>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 570,
            display: "flex",
            justifyContent: "center",
            gap: 18,
            opacity: move(lt, 0.5, 0.35),
          }}
        >
          <div
            style={{
              width: 560,
              height: 88,
              borderRadius: 88,
              border: `1px solid ${C.line}`,
              background: C.card,
              boxShadow: C.shadowSoft,
              display: "flex",
              alignItems: "center",
              padding: "0 36px",
              fontSize: 32,
              color: C.soft,
            }}
          >
            {SITE}
          </div>
          <div
            style={{
              height: 88,
              borderRadius: 88,
              background: C.ink,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "0 40px",
              fontSize: 32,
              fontWeight: 600,
            }}
          >
            Get started
            <Glyph name="arrowRight" size={30} color="#fff" stroke={2.4} />
          </div>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 240,
          top: 400,
          width: 1440,
          height: 180,
          borderRadius: 52,
          background: C.card,
          border: `1px solid #E3E0D2`,
          boxShadow: C.shadow,
          display: "flex",
          alignItems: "center",
          gap: 36,
          padding: "0 60px",
          fontSize: 84,
          fontWeight: 500,
          letterSpacing: "-0.02em",
          color: C.ink,
          opacity: bar,
          transform: `scale(${lerp(0.74, 1, bar).toFixed(4)})`,
        }}
      >
        <Mark width={120} />
        <Typing text={typed(SITE, typing)} full={typing >= 1} lt={lt} />
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 660,
          display: "flex",
          justifyContent: "center",
          gap: 22,
        }}
      >
        {["Brand", "Audience", "Competitors"].map((label, index) => (
          <Badge key={label} lt={lt} at={2.15 + index * 0.18} label={label} size={36} />
        ))}
      </div>
      <div style={{ ...row, top: 790, fontSize: 36, color: C.mute, opacity: move(lt, 2.4, 0.35) }}>
        One scan fills your whole Brain
      </div>
    </>
  );
}

const AREAS: { label: string; icon: GlyphName }[] = [
  { label: "Brain", icon: "brain" },
  { label: "Studio", icon: "studio" },
  { label: "AI Visibility", icon: "visibility" },
  { label: "Chat", icon: "chat" },
];

function AreaPill({ lt, index }: { lt: number; index: number }) {
  const area = AREAS[index];
  const pop = easeOutBack(progress(lt, 0.1 + index * 0.13, 0.45));
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 20,
        padding: "22px 38px",
        borderRadius: 26,
        background: C.card,
        border: `1px solid ${C.line}`,
        boxShadow: C.shadow,
        fontSize: 52,
        fontWeight: 500,
        color: C.mute,
        opacity: progress(lt, 0.1 + index * 0.13, 0.2),
        transform: `scale(${lerp(0.7, 1, pop).toFixed(4)})`,
      }}
    >
      <Glyph name={area.icon} size={50} color={C.mute} />
      {area.label}
    </div>
  );
}

export function PanelsScene({ lt }: SceneProps) {
  const pills = 1 - progress(lt, 1.1, 0.25);
  const strip = move(lt, 1.2, 0.45);
  const pan = easeInOut(progress(lt, 1.45, 1.3));
  const chatLeft = 3 * (PANEL.width + PANEL.gap);
  return (
    <>
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: pills,
          transform: `scale(${lerp(1, 1.16, progress(lt, 1.0, 0.35)).toFixed(4)})`,
        }}
      >
        <div
          style={{
            ...row,
            top: 400,
            display: "flex",
            justifyContent: "center",
            gap: 70,
            transform: "translateX(30px)",
          }}
        >
          <AreaPill lt={lt} index={0} />
          <AreaPill lt={lt} index={1} />
        </div>
        <div
          style={{
            ...row,
            top: 550,
            display: "flex",
            justifyContent: "center",
            gap: 70,
            transform: "translateX(-40px)",
          }}
        >
          <AreaPill lt={lt} index={2} />
          <AreaPill lt={lt} index={3} />
        </div>
      </div>

      <AppStrip
        style={{
          left: lerp(90, 130 - chatLeft, pan),
          top: 130,
          opacity: strip,
          transform: `scale(${lerp(0.92, 1, strip).toFixed(4)})`,
          transformOrigin: "30% 50%",
        }}
      />

      <div style={{ position: "absolute", left: 860, top: 360, width: 1000 }}>
        <Words
          lt={lt}
          size={92}
          words={sentence("Everything a marketing team does, handled for you.", 2.6, 0.085)}
        />
      </div>
    </>
  );
}

const BRAINS: { label: string; icon: GlyphName }[] = [
  { label: "Brand", icon: "brand" },
  { label: "Audience", icon: "audience" },
  { label: "Competitors", icon: "rivals" },
  { label: "Market", icon: "market" },
];

export function BrainsScene({ lt }: SceneProps) {
  return (
    <>
      <div style={{ ...row, top: 190 }}>
        <Words lt={lt} size={128} words={sentence("Four brains.", 0.05, 0.14)} />
      </div>
      <div style={{ ...row, top: 420, display: "flex", justifyContent: "center", gap: 74 }}>
        {BRAINS.map((brain, index) => {
          const pop = easeOutBack(progress(lt, 0.35 + index * 0.1, 0.45));
          return (
            <div
              key={brain.label}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 18,
                opacity: progress(lt, 0.35 + index * 0.1, 0.2),
                transform: `scale(${lerp(0.6, 1, pop).toFixed(4)})`,
              }}
            >
              <Tile size={150} background={index === 0 ? C.lime : C.card}>
                <Glyph name={brain.icon} size={72} color={C.ink} stroke={1.7} />
              </Tile>
              <span style={{ fontSize: 30, fontWeight: 600, color: C.mute }}>{brain.label}</span>
            </div>
          );
        })}
      </div>
      <div style={{ ...row, top: 680 }}>
        <Words lt={lt} size={128} words={sentence("One strategy.", 1.0, 0.14)} />
      </div>
      <div style={{ ...row, top: 870 }}>
        <Words
          lt={lt}
          size={44}
          weight={500}
          words={sentence("Plans. Creates. Posts. Fixes.", 1.25, 0.12)}
        />
      </div>
    </>
  );
}
