import type { CSSProperties, ReactNode } from "react";
import { NotionMark, SlackMark } from "@/components/brand/AppMarks";
import { BrandLogo, type BrandKey } from "@/components/brand/BrandLogo";
import { SiteLogo } from "@/components/brand/SiteLogos";
import { count, easeInOut, easeOutBack, lerp, move, progress, typed } from "@/lib/promo/timeline";
import { AppStrip, ScoreRing, STRIP_WIDTH } from "./panels";
import {
  Badge,
  C,
  Card,
  Chip,
  Glyph,
  type GlyphName,
  Lines,
  Lockup,
  Mark,
  Pointer,
  Tile,
  Typing,
  Words,
  sentence,
} from "./parts";
import type { SceneProps } from "./scenes-open";

/** The feature scenes, the chat, and the close of the film. */

const row: CSSProperties = { position: "absolute", left: 0, right: 0, textAlign: "center" };

function FeatureTitle({
  lt,
  icon,
  title,
  badge,
  badgeAt,
}: {
  lt: number;
  icon: GlyphName;
  title: string;
  badge: string;
  badgeAt: number;
}) {
  const enter = move(lt, 0.05, 0.4);
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 64,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: 28,
      }}
    >
      <Tile
        size={100}
        background={C.lime}
        style={{ opacity: enter, transform: `scale(${lerp(0.7, 1, enter).toFixed(4)})` }}
      >
        <Glyph name={icon} size={54} color={C.ink} stroke={1.8} />
      </Tile>
      <span
        style={{
          fontSize: 84,
          fontWeight: 600,
          letterSpacing: "-0.028em",
          color: C.ink,
          opacity: enter,
        }}
      >
        {title}
      </span>
      <Badge lt={lt} at={badgeAt} label={badge} size={36} />
    </div>
  );
}

function CardHead({ icon, label, right }: { icon: GlyphName; label: string; right?: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 24,
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          fontSize: 30,
          fontWeight: 600,
          color: C.ink,
        }}
      >
        <Glyph name={icon} size={32} color={C.mute} />
        {label}
      </span>
      {right}
    </div>
  );
}

function rise(lt: number, at: number): CSSProperties {
  const p = move(lt, at, 0.5);
  return { opacity: p, transform: `translateY(${((1 - p) * 60).toFixed(2)}px)` };
}

function shown(lt: number, at: number): CSSProperties {
  const p = move(lt, at, 0.3);
  return { opacity: p, transform: `translateX(${((1 - p) * -16).toFixed(2)}px)` };
}

function ListRow({
  lt,
  at,
  left,
  right,
}: {
  lt: number;
  at: number;
  left: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        fontSize: 26,
        color: C.ink,
        padding: "11px 0",
        ...shown(lt, at),
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 14 }}>{left}</span>
      {right}
    </div>
  );
}

function Swatch({ color }: { color: string }) {
  return (
    <span
      style={{ width: 26, height: 26, borderRadius: 8, background: color, display: "inline-block" }}
    />
  );
}

export function BrainScene({ lt }: SceneProps) {
  const size = { width: 620, height: 340, padding: 32 };
  return (
    <>
      <FeatureTitle lt={lt} icon="brain" title="Brain" badge="Learned" badgeAt={1.9} />
      <Card style={{ left: 320, top: 240, ...size, ...rise(lt, 0.2) }}>
        <CardHead icon="brand" label="Brand" />
        <div style={{ display: "flex", gap: 14, marginBottom: 24 }}>
          {["#0B0C0E", "#D4E85C", "#2F6600", "#F2F3F1", "#BFD3F7"].map((color, index) => {
            const pop = easeOutBack(progress(lt, 0.6 + index * 0.08, 0.35));
            return (
              <span
                key={color}
                style={{
                  width: 70,
                  height: 70,
                  borderRadius: 18,
                  background: color,
                  border: `1px solid ${C.line}`,
                  transform: `scale(${pop.toFixed(4)})`,
                }}
              />
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 10, ...shown(lt, 1.1) }}>
          <Chip label="Clear" tone="plain" size={22} />
          <Chip label="Warm" tone="plain" size={22} />
          <Chip label="Direct" tone="plain" size={22} />
        </div>
      </Card>
      <Card style={{ left: 980, top: 240, ...size, ...rise(lt, 0.32) }}>
        <CardHead
          icon="audience"
          label="Audience"
          right={<Chip label="3 groups" size={20} style={shown(lt, 1.4)} />}
        />
        <ListRow
          lt={lt}
          at={0.8}
          left={
            <>
              <Swatch color="#D4E85C" />
              Busy founders
            </>
          }
        />
        <ListRow
          lt={lt}
          at={0.95}
          left={
            <>
              <Swatch color="#BFD3F7" />
              Marketing leads
            </>
          }
        />
        <ListRow
          lt={lt}
          at={1.1}
          left={
            <>
              <Swatch color="#F6D2B8" />
              Agency owners
            </>
          }
        />
      </Card>
      <Card style={{ left: 320, top: 620, ...size, ...rise(lt, 0.44) }}>
        <CardHead icon="rivals" label="Competitors" />
        <ListRow
          lt={lt}
          at={0.95}
          left={
            <>
              <Swatch color={C.line} />
              northpeak.io
            </>
          }
          right={<Chip label="2 updates" tone="amber" size={20} />}
        />
        <ListRow
          lt={lt}
          at={1.1}
          left={
            <>
              <Swatch color={C.line} />
              brightlane.com
            </>
          }
          right={<Chip label="Tracked" tone="plain" size={20} />}
        />
        <ListRow
          lt={lt}
          at={1.25}
          left={
            <>
              <Swatch color={C.line} />
              fieldnote.co
            </>
          }
          right={<Chip label="Tracked" tone="plain" size={20} />}
        />
      </Card>
      <Card style={{ left: 980, top: 620, ...size, ...rise(lt, 0.56) }}>
        <CardHead
          icon="market"
          label="Market"
          right={<Chip label="12 fresh sources" size={20} style={shown(lt, 1.6)} />}
        />
        <Lines widths={[96, 88, 74, 92, 58]} p={progress(lt, 0.95, 0.9)} height={16} gap={20} />
      </Card>
    </>
  );
}

const CAPTION =
  "Marketing shouldn't need you every day. Here are five signs it does, and what to do about each one.";

export function StudioScene({ lt }: SceneProps) {
  const fan = move(lt, 0.2, 0.75);
  const slides: {
    offset: number;
    turn: number;
    node: ReactNode;
    background: string;
    color: string;
  }[] = [
    {
      offset: -360,
      turn: -8,
      background: `linear-gradient(140deg, ${C.ink} 0%, #1F2A12 60%, ${C.moss} 140%)`,
      color: "#fff",
      node: (
        <>
          <span style={{ fontSize: 20, fontWeight: 600, opacity: 0.7 }}>1 of 6</span>
          <span
            style={{ fontSize: 46, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.08 }}
          >
            Five signs your marketing runs you
          </span>
          <span style={{ width: 90, height: 9, borderRadius: 9, background: C.lime }} />
        </>
      ),
    },
    {
      offset: 0,
      turn: 0,
      background: C.card,
      color: C.ink,
      node: (
        <>
          <span
            style={{
              fontSize: 110,
              fontWeight: 600,
              letterSpacing: "-0.04em",
              lineHeight: 1,
              color: C.moss,
            }}
          >
            1
          </span>
          <span
            style={{ fontSize: 40, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.12 }}
          >
            You post when you remember
          </span>
          <span style={{ width: 90, height: 9, borderRadius: 9, background: C.ink }} />
        </>
      ),
    },
    {
      offset: 360,
      turn: 8,
      background: C.lime,
      color: C.ink,
      node: (
        <>
          <span style={{ fontSize: 20, fontWeight: 600, opacity: 0.7 }}>6 of 6</span>
          <span
            style={{ fontSize: 44, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.1 }}
          >
            Set it up once. It runs every day.
          </span>
          <Mark width={92} />
        </>
      ),
    },
  ];
  return (
    <>
      <FeatureTitle lt={lt} icon="studio" title="Studio" badge="Approved" badgeAt={2.0} />
      {[0, 2, 1].map((index) => {
        const slide = slides[index];
        return (
          <div
            key={index}
            style={{
              position: "absolute",
              left: 430,
              top: 310,
              width: 400,
              height: 500,
              borderRadius: 30,
              padding: 38,
              background: slide.background,
              color: slide.color,
              border: `1px solid ${C.line}`,
              boxShadow: C.shadow,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              opacity: move(lt, 0.15, 0.4),
              transform: `translate(${(slide.offset * fan).toFixed(2)}px, ${((1 - fan) * 90 + Math.abs(slide.turn) * 3 * fan).toFixed(2)}px) rotate(${(slide.turn * fan).toFixed(3)}deg)`,
            }}
          >
            {slide.node}
          </div>
        );
      })}
      <Card
        style={{ left: 1270, top: 320, width: 560, height: 470, padding: 34, ...rise(lt, 0.5) }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontSize: 28,
            fontWeight: 600,
            color: C.ink,
            marginBottom: 24,
          }}
        >
          <BrandLogo name="instagram" brand size={36} />
          Instagram
        </div>
        <div style={{ fontSize: 30, lineHeight: 1.4, color: C.ink, height: 220 }}>
          <Typing text={typed(CAPTION, progress(lt, 0.85, 1.15))} full={lt > 2} lt={lt} />
        </div>
        <div style={{ display: "flex", gap: 12, ...shown(lt, 2.05) }}>
          <Chip label="Mellox Score 86" size={22} />
          <Chip label="In your voice" tone="plain" size={22} />
        </div>
      </Card>
    </>
  );
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const POSTS: { day: number; slot: number; brand: BrandKey; title: string }[] = [
  { day: 0, slot: 0, brand: "linkedin", title: "Post" },
  { day: 0, slot: 1, brand: "x", title: "Thread" },
  { day: 1, slot: 0, brand: "instagram", title: "Carousel" },
  { day: 2, slot: 0, brand: "linkedin", title: "Post" },
  { day: 2, slot: 1, brand: "tiktok", title: "Short video" },
  { day: 3, slot: 0, brand: "x", title: "Post" },
  { day: 4, slot: 0, brand: "instagram", title: "Post" },
  { day: 4, slot: 1, brand: "linkedin", title: "Article" },
  { day: 5, slot: 0, brand: "youtube", title: "Short video" },
  { day: 6, slot: 0, brand: "x", title: "Post" },
];

export function AutopilotScene({ lt }: SceneProps) {
  const column = 206;
  return (
    <>
      <FeatureTitle lt={lt} icon="autopilot" title="Autopilot" badge="Posted" badgeAt={2.1} />
      <Card
        style={{ left: 200, top: 240, width: 1520, height: 720, padding: 34, ...rise(lt, 0.15) }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 22,
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontSize: 30,
              fontWeight: 600,
              color: C.ink,
            }}
          >
            <Glyph name="calendar" size={32} color={C.mute} />
            This week
          </span>
          <Chip label="Runs every day by itself" tone="plain" size={21} />
        </div>
        <div style={{ position: "relative", height: 590 }}>
          {DAYS.map((day, index) => (
            <div
              key={day}
              style={{
                position: "absolute",
                left: index * column,
                top: 0,
                width: column - 14,
                height: 590,
                borderRadius: 18,
                background: C.wash,
                padding: "14px 16px",
                fontSize: 21,
                fontWeight: 600,
                color: C.mute,
              }}
            >
              {day}
            </div>
          ))}
          {POSTS.map((post, index) => {
            const at = 0.4 + index * 0.08;
            const pop = easeOutBack(progress(lt, at, 0.4));
            const sent = lt >= 1.25 + post.day * 0.14 && post.day < 5;
            return (
              <div
                key={`${post.day}-${post.slot}`}
                style={{
                  position: "absolute",
                  left: post.day * column + 12,
                  top: 58 + post.slot * 256,
                  width: column - 38,
                  height: 240,
                  borderRadius: 16,
                  background: C.card,
                  border: `1px solid ${C.line}`,
                  boxShadow: C.shadowSoft,
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  opacity: progress(lt, at, 0.18),
                  transform: `scale(${lerp(0.7, 1, pop).toFixed(4)})`,
                }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 21,
                    fontWeight: 600,
                    color: C.ink,
                  }}
                >
                  <BrandLogo name={post.brand} brand size={26} />
                  {post.title}
                </span>
                <div style={{ height: 70, borderRadius: 10, background: C.wash }} />
                <Lines widths={[92, 60]} height={9} gap={9} />
                <Chip
                  label={sent ? "Posted" : "Scheduled"}
                  tone={sent ? "moss" : "plain"}
                  size={17}
                  style={{ alignSelf: "flex-start" }}
                />
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}

const FINDINGS = [
  "Add FAQ answers",
  "Describe each page",
  "Name the author",
  "Let AI search read the site",
];

export function VisibilityScene({ lt }: SceneProps) {
  const score = count(62, 94, progress(lt, 0.5, 1.4));
  const merged = lt >= 1.95;
  return (
    <>
      <FeatureTitle lt={lt} icon="visibility" title="AI Visibility" badge="Fixed" badgeAt={2.15} />
      <Card
        style={{
          left: 240,
          top: 250,
          width: 620,
          height: 690,
          padding: 36,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 30,
          ...rise(lt, 0.2),
        }}
      >
        <ScoreRing value={score} size={360} stroke={26} />
        <span style={{ fontSize: 32, fontWeight: 600, color: C.ink }}>
          How AI answers see your site
        </span>
        <Chip label="+32 since your fixes" size={24} style={shown(lt, 1.95)} />
      </Card>
      <Card
        style={{ left: 920, top: 250, width: 760, height: 430, padding: 36, ...rise(lt, 0.32) }}
      >
        <CardHead icon="spark" label="Findings" />
        {FINDINGS.map((finding, index) => {
          const fixed = lt >= 0.9 + index * 0.26;
          return (
            <ListRow
              key={finding}
              lt={lt}
              at={0.5 + index * 0.08}
              left={finding}
              right={
                <Chip
                  label={fixed ? "Fixed" : "To fix"}
                  tone={fixed ? "moss" : "amber"}
                  size={20}
                />
              }
            />
          );
        })}
      </Card>
      <Card
        style={{
          left: 920,
          top: 710,
          width: 760,
          height: 230,
          padding: 36,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          ...rise(lt, 0.44),
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <Tile size={86} background={C.wash}>
            <Glyph name="pr" size={44} color={C.ink} />
          </Tile>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 32, fontWeight: 600, color: C.ink }}>Fix all</span>
            <span style={{ fontSize: 24, color: C.mute }}>9 fixes in one pull request</span>
          </div>
        </div>
        <Chip
          label={merged ? "Live" : "Ready for you"}
          tone={merged ? "moss" : "plain"}
          size={24}
        />
      </Card>
    </>
  );
}

type Service = { name: string; note: string; logo: ReactNode };

const SERVICES: Service[] = [
  {
    name: "GitHub",
    note: "Fixes as pull requests",
    logo: <SiteLogo provider="github" size={54} />,
  },
  {
    name: "WordPress",
    note: "Publish articles",
    logo: <SiteLogo provider="wordpress" brand size={54} />,
  },
  {
    name: "Webflow",
    note: "Publish articles",
    logo: <SiteLogo provider="webflow" brand size={54} />,
  },
  {
    name: "Slack",
    note: "Updates for your team",
    logo: <SlackMark className="h-[54px] w-[54px]" />,
  },
  { name: "Notion", note: "Your notes", logo: <NotionMark className="h-[54px] w-[54px]" /> },
  {
    name: "Instagram",
    note: "Post and schedule",
    logo: <BrandLogo name="instagram" brand size={54} />,
  },
  {
    name: "LinkedIn",
    note: "Post and schedule",
    logo: <BrandLogo name="linkedin" brand size={54} />,
  },
  { name: "TikTok", note: "Post and schedule", logo: <BrandLogo name="tiktok" brand size={54} /> },
];

export function ConnectScene({ lt }: SceneProps) {
  return (
    <>
      {SERVICES.map((service, index) => {
        const top = index < 4;
        const position = index % 4;
        const p = move(lt, 0.1 + position * 0.08 + (top ? 0 : 0.12), 0.55);
        return (
          <Card
            key={service.name}
            style={{
              left: 100 + position * 440,
              top: top ? 110 : 760,
              width: 400,
              height: 210,
              padding: 28,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              opacity: p,
              transform: `translateX(${((1 - p) * (top ? -120 : 120)).toFixed(2)}px)`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              {service.logo}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 30, fontWeight: 600, color: C.ink }}>{service.name}</span>
                <span style={{ fontSize: 21, color: C.mute }}>{service.note}</span>
              </div>
            </div>
            <Chip
              label="Connected"
              size={19}
              style={{ alignSelf: "flex-end", opacity: progress(lt, 0.9 + position * 0.1, 0.2) }}
            />
          </Card>
        );
      })}
      <div style={{ ...row, top: 460 }}>
        <Words lt={lt} size={112} words={sentence("And it connects to your stack.", 0.3, 0.1)} />
      </div>
    </>
  );
}

const ASK = "Plan next week's posts from what worked, and fix what hurts our AI visibility.";
const PLAN: { what: string; where: string }[] = [
  { what: "5 posts", where: "LinkedIn, Instagram, X" },
  { what: "1 carousel", where: "Instagram" },
  { what: "1 article", where: "Your blog" },
  { what: "9 website fixes", where: "One pull request" },
];
const RESULTS: { label: string; value: (p: number) => string }[] = [
  { label: "Posts sent", value: (p) => String(count(0, 7, p)) },
  { label: "Views", value: (p) => `${(count(0, 482, p) / 10).toFixed(1)}K` },
  { label: "AI Visibility", value: (p) => String(count(62, 94, p)) },
  { label: "Fixes live", value: (p) => String(count(0, 9, p)) },
];

export function ChatScene({ lt }: SceneProps) {
  const typing = progress(lt, 0.2, 1.0);
  const sendPress = progress(lt, 1.28, 0.08) * (1 - progress(lt, 1.36, 0.1));
  const ask = 1 - progress(lt, 1.42, 0.22);
  const plan = move(lt, 1.6, 0.4) * (1 - progress(lt, 3.5, 0.2));
  const travel = easeInOut(progress(lt, 2.3, 0.6));
  const click = progress(lt, 2.95, 0.07) * (1 - progress(lt, 3.02, 0.12));
  const approved = lt >= 3.02;
  const results = move(lt, 3.7, 0.4);
  return (
    <>
      <Card
        style={{
          left: 310,
          top: 320,
          width: 1300,
          height: 400,
          padding: 48,
          borderRadius: 40,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          opacity: ask * move(lt, 0, 0.3),
          transform: `translateY(${((1 - ask) * -70).toFixed(2)}px)`,
        }}
      >
        <div style={{ fontSize: 54, lineHeight: 1.3, letterSpacing: "-0.015em", color: C.ink }}>
          <Typing text={typed(ASK, typing)} full={typing >= 1} lt={lt} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontSize: 28,
              fontWeight: 600,
              color: C.mute,
            }}
          >
            <span
              style={{
                width: 64,
                height: 36,
                borderRadius: 36,
                background: C.moss,
                display: "flex",
                justifyContent: "flex-end",
                alignItems: "center",
                padding: 4,
              }}
            >
              <span style={{ width: 28, height: 28, borderRadius: 28, background: "#fff" }} />
            </span>
            Autopilot
          </span>
          <span
            style={{
              width: 76,
              height: 76,
              borderRadius: 76,
              background: typing >= 1 ? C.ink : C.soft,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transform: `scale(${(1 - sendPress * 0.14).toFixed(4)})`,
            }}
          >
            <Glyph name="arrowUp" size={38} color="#fff" stroke={2.4} />
          </span>
        </div>
      </Card>

      <div style={{ position: "absolute", inset: 0, opacity: plan }}>
        <Card
          style={{
            left: 520,
            top: 110,
            width: 880,
            height: 510,
            padding: 40,
            transform: `translateY(${((1 - move(lt, 1.6, 0.4)) * 70).toFixed(2)}px)`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              fontSize: 32,
              fontWeight: 600,
              color: C.ink,
              marginBottom: 18,
            }}
          >
            <Mark width={62} />
            Next week&apos;s plan
          </div>
          {PLAN.map((item, index) => (
            <div
              key={item.what}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "17px 0",
                borderTop: `1px solid ${C.line}`,
                fontSize: 30,
                ...shown(lt, 1.8 + index * 0.09),
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  color: C.ink,
                  fontWeight: 600,
                }}
              >
                <Glyph name="check" size={28} color={C.moss} stroke={2.6} />
                {item.what}
              </span>
              <span style={{ color: C.mute, fontSize: 26 }}>{item.where}</span>
            </div>
          ))}
          <div style={{ display: "flex", gap: 16, marginTop: 26 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 12,
                padding: "20px 38px",
                borderRadius: 999,
                background: approved ? C.moss : C.ink,
                color: "#fff",
                fontSize: 30,
                fontWeight: 600,
                transform: `scale(${(1 - click * 0.06).toFixed(4)})`,
              }}
            >
              {approved ? "Approved" : "Approve"}
              {approved ? <Glyph name="check" size={28} color="#fff" stroke={2.8} /> : null}
            </span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "20px 38px",
                borderRadius: 999,
                border: `1px solid ${C.line}`,
                color: C.mute,
                fontSize: 30,
                fontWeight: 600,
              }}
            >
              Edit
            </span>
          </div>
        </Card>
        <div style={{ ...row, top: 720 }}>
          <Words lt={lt} size={128} words={sentence("You just approve.", 2.2, 0.13)} />
        </div>
        <Pointer x={lerp(1300, 684, travel)} y={lerp(930, 516, travel)} press={click} />
      </div>

      <div style={{ position: "absolute", inset: 0, opacity: results }}>
        <Card
          style={{
            left: 310,
            top: 170,
            width: 1300,
            height: 410,
            padding: 44,
            transform: `translateY(${((1 - results) * 70).toFixed(2)}px)`,
          }}
        >
          <CardHead icon="market" label="This week" right={<Chip label="All done" size={22} />} />
          <div style={{ display: "flex", gap: 22 }}>
            {RESULTS.map((result, index) => (
              <div
                key={result.label}
                style={{
                  flex: 1,
                  height: 250,
                  borderRadius: 20,
                  border: `1px solid ${C.line}`,
                  background: C.bg,
                  padding: 28,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                }}
              >
                <span
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    letterSpacing: "0.07em",
                    textTransform: "uppercase",
                    color: C.soft,
                  }}
                >
                  {result.label}
                </span>
                <span
                  style={{
                    fontSize: 86,
                    fontWeight: 600,
                    letterSpacing: "-0.03em",
                    color: C.ink,
                    lineHeight: 1,
                  }}
                >
                  {result.value(progress(lt, 3.85 + index * 0.08, 0.7))}
                </span>
              </div>
            ))}
          </div>
        </Card>
        <div style={{ ...row, top: 700 }}>
          <Words lt={lt} size={128} words={sentence("Mellox does the rest.", 3.95, 0.12)} />
        </div>
      </div>
    </>
  );
}

const ORBIT: { left: number; top: number; icon: GlyphName; lime?: boolean }[] = [
  { left: 330, top: 210, icon: "brain", lime: true },
  { left: 900, top: 110, icon: "studio" },
  { left: 1470, top: 230, icon: "autopilot" },
  { left: 300, top: 730, icon: "visibility" },
  { left: 900, top: 850, icon: "chat" },
  { left: 1500, top: 710, icon: "calendar" },
];

export function AllInOneScene({ lt }: SceneProps) {
  const first = 1 - progress(lt, 0.98, 0.2);
  const app = move(lt, 1.08, 0.4);
  const scale = 0.66;
  const blur = (1 - app) * 14;
  return (
    <>
      <div style={{ position: "absolute", inset: 0, opacity: first }}>
        {ORBIT.map((tile, index) => {
          const pop = easeOutBack(progress(lt, 0.1 + index * 0.07, 0.45));
          const floatX = Math.cos(lt * 1.1 + index * 1.3) * 10;
          const floatY = Math.sin(lt * 1.3 + index * 2.1) * 12;
          return (
            <Tile
              key={tile.icon}
              size={124}
              background={tile.lime ? C.lime : C.card}
              style={{
                position: "absolute",
                left: tile.left,
                top: tile.top,
                borderRadius: 124,
                opacity: progress(lt, 0.1 + index * 0.07, 0.2),
                transform: `translate(${floatX.toFixed(2)}px, ${floatY.toFixed(2)}px) scale(${lerp(0.5, 1, pop).toFixed(4)})`,
              }}
            >
              <Glyph name={tile.icon} size={58} color={C.ink} stroke={1.8} />
            </Tile>
          );
        })}
        <div
          style={{ position: "absolute", left: 460, width: 1000, top: 400, textAlign: "center" }}
        >
          <Words lt={lt} size={112} words={sentence("Everything you need to grow.", 0.08, 0.085)} />
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: (1920 - STRIP_WIDTH * scale) / 2,
          top: lerp(120, 70, app),
          opacity: app,
          filter: blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : undefined,
          transform: `scale(${scale})`,
          transformOrigin: "0 0",
        }}
      >
        <AppStrip style={{ left: 0, top: 0 }} />
      </div>
      <div style={{ ...row, top: 700 }}>
        <Words lt={lt} size={176} words={sentence("All in one", 1.28, 0.14)} />
      </div>
    </>
  );
}

export function OutroScene({ lt, site }: SceneProps & { site: string }) {
  const pop = easeOutBack(progress(lt, 0.05, 0.6));
  const lift = move(lt, 0.75, 0.55);
  const cta = move(lt, 0.95, 0.45);
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: lerp(455, 350, lift),
          display: "flex",
          justifyContent: "center",
          opacity: progress(lt, 0.05, 0.25),
          transform: `scale(${lerp(0.7, 1, pop).toFixed(4)})`,
        }}
      >
        <Lockup size={150} />
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 590,
          display: "flex",
          justifyContent: "center",
          opacity: cta,
          transform: `translateY(${((1 - cta) * 30).toFixed(2)}px)`,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 18,
            padding: "28px 56px",
            borderRadius: 30,
            background: C.ink,
            color: "#fff",
            fontSize: 50,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            boxShadow: C.shadow,
          }}
        >
          Get started
          <Glyph name="arrowRight" size={46} color={C.lime} stroke={2.4} />
          {site}
        </div>
      </div>
      <div style={{ ...row, top: 770 }}>
        <Words
          lt={lt}
          size={46}
          weight={500}
          words={sentence("Your AI marketing team", 1.1, 0.1)}
        />
      </div>
    </>
  );
}
