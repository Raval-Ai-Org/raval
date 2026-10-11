import type { CSSProperties, ReactNode } from "react";
import { C, Chip, Glyph, type GlyphName, Lines, Mark } from "./parts";

/**
 * Stand-in app panels for the film: Brain, Studio, AI Visibility and chat.
 * Sample content only. They are still pictures; the scenes move them.
 */

export const PANEL = { width: 620, height: 820, gap: 26 } as const;
export const STRIP_WIDTH = PANEL.width * 4 + PANEL.gap * 3;

function Panel({ icon, title, children }: { icon: GlyphName; title: string; children: ReactNode }) {
  return (
    <div
      style={{
        width: PANEL.width,
        height: PANEL.height,
        flexShrink: 0,
        background: C.card,
        border: `1px solid ${C.line}`,
        borderRadius: 26,
        boxShadow: C.shadow,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "20px 26px",
          borderBottom: `1px solid ${C.line}`,
          color: C.mute,
          fontSize: 22,
          fontWeight: 600,
        }}
      >
        <Glyph name={icon} size={24} color={C.mute} />
        {title}
      </div>
      <div style={{ flex: 1, padding: 26, display: "flex", flexDirection: "column", gap: 20 }}>
        {children}
      </div>
    </div>
  );
}

function Block({
  label,
  children,
  style,
}: {
  label: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 18, padding: 20, ...style }}>
      <div
        style={{
          fontSize: 15,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: C.soft,
          marginBottom: 14,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        fontSize: 20,
        color: C.ink,
        padding: "9px 0",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 12 }}>{left}</span>
      {right}
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <span
      style={{ width: 22, height: 22, borderRadius: 7, background: color, display: "inline-block" }}
    />
  );
}

export function BrainPanel() {
  return (
    <Panel icon="brain" title="Brain">
      <Block label="Brand">
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          {["#0B0C0E", "#D4E85C", "#2F6600", "#F2F3F1"].map((color) => (
            <span
              key={color}
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: color,
                border: `1px solid ${C.line}`,
              }}
            />
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Chip label="Clear" tone="plain" />
          <Chip label="Warm" tone="plain" />
          <Chip label="Direct" tone="plain" />
        </div>
      </Block>
      <Block label="Audience">
        <Row
          left={
            <>
              <Dot color="#D4E85C" />
              Busy founders
            </>
          }
          right={<Chip label="Main" />}
        />
        <Row
          left={
            <>
              <Dot color="#BFD3F7" />
              Marketing leads
            </>
          }
        />
        <Row
          left={
            <>
              <Dot color="#F6D2B8" />
              Agency owners
            </>
          }
        />
      </Block>
      <Block label="Competitors">
        <Row
          left={
            <>
              <Dot color="#E7E8EB" />
              northpeak.io
            </>
          }
          right={<Chip label="2 updates" tone="amber" />}
        />
        <Row
          left={
            <>
              <Dot color="#E7E8EB" />
              brightlane.com
            </>
          }
          right={<Chip label="Tracked" tone="plain" />}
        />
      </Block>
      <Block label="Market" style={{ flex: 1 }}>
        <Lines widths={[92, 78, 60]} />
      </Block>
    </Panel>
  );
}

export function StudioPanel() {
  return (
    <Panel icon="studio" title="Studio">
      <div
        style={{
          height: 300,
          borderRadius: 18,
          background: `linear-gradient(135deg, ${C.ink} 0%, #1F2A12 55%, ${C.moss} 130%)`,
          padding: 28,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          color: "#fff",
        }}
      >
        <Chip label="Carousel · 1 of 6" tone="plain" style={{ alignSelf: "flex-start" }} />
        <div style={{ fontSize: 40, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.1 }}>
          Five signs your
          <br />
          marketing runs you
        </div>
        <span style={{ width: 90, height: 8, borderRadius: 8, background: C.lime }} />
      </div>
      <Lines widths={[96, 88, 52]} />
      <Block label="This week" style={{ flex: 1 }}>
        <Row left="LinkedIn post" right={<Chip label="Approved" />} />
        <Row left="Instagram carousel" right={<Chip label="Approved" />} />
        <Row left="Blog article" right={<Chip label="Waiting for you" tone="amber" />} />
        <Row left="X thread" right={<Chip label="Draft" tone="plain" />} />
      </Block>
    </Panel>
  );
}

export function ScoreRing({
  value,
  size,
  stroke = 16,
}: {
  value: number;
  size: number;
  stroke?: number;
}) {
  const radius = (size - stroke) / 2;
  const around = 2 * Math.PI * radius;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)", display: "block" }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={C.wash}
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={C.moss}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={around}
          strokeDashoffset={around * (1 - value / 100)}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: size * 0.34,
          fontWeight: 600,
          letterSpacing: "-0.03em",
          color: C.ink,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 19, color: C.mute }}>
      <span style={{ width: 150 }}>{label}</span>
      <span
        style={{ flex: 1, height: 10, borderRadius: 10, background: C.wash, overflow: "hidden" }}
      >
        <span
          style={{
            display: "block",
            width: `${value}%`,
            height: "100%",
            borderRadius: 10,
            background: C.moss,
          }}
        />
      </span>
      <span style={{ width: 34, textAlign: "right", color: C.ink, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

export function VisibilityPanel() {
  return (
    <Panel icon="visibility" title="AI Visibility">
      <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
        <ScoreRing value={94} size={190} />
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 26, fontWeight: 600, color: C.ink }}>Ready for AI answers</div>
          <Chip label="+32 since your fixes" style={{ alignSelf: "flex-start" }} />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Bar label="Can be read" value={98} />
        <Bar label="Clear answers" value={92} />
        <Bar label="Trust" value={90} />
      </div>
      <Block label="Findings" style={{ flex: 1 }}>
        <Row left="Add FAQ answers" right={<Chip label="Fixed" />} />
        <Row left="Describe each page" right={<Chip label="Fixed" />} />
        <Row left="Name the author" right={<Chip label="Fixed" />} />
        <Row left="Let AI search read the site" right={<Chip label="Fixed" />} />
      </Block>
    </Panel>
  );
}

export function ChatPanel() {
  return (
    <Panel icon="chat" title="Chat">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          color: C.soft,
          fontSize: 17,
          fontWeight: 600,
        }}
      >
        <Mark width={34} />
        Mellox
      </div>
      <div
        style={{
          background: C.wash,
          borderRadius: 18,
          padding: 24,
          fontSize: 22,
          lineHeight: 1.45,
          color: C.ink,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <span>Hi, I&apos;ve read your site and your market.</span>
        <span>This week I planned five posts, one carousel and one article.</span>
        <span>Pick what to look at first, or ask me anything.</span>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Chip label="See the plan" tone="plain" size={19} />
        <Chip label="Open Brain" tone="plain" size={19} />
      </div>
      <div style={{ flex: 1 }} />
      <div
        style={{
          border: `1px solid ${C.line}`,
          borderRadius: 20,
          padding: 20,
          boxShadow: C.shadowSoft,
          display: "flex",
          flexDirection: "column",
          gap: 26,
        }}
      >
        <span style={{ fontSize: 21, color: C.soft }}>Ask anything…</span>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 18,
              color: C.mute,
              fontWeight: 600,
            }}
          >
            <span
              style={{
                width: 44,
                height: 26,
                borderRadius: 26,
                background: C.moss,
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                padding: 3,
              }}
            >
              <span style={{ width: 20, height: 20, borderRadius: 20, background: "#fff" }} />
            </span>
            Autopilot
          </span>
          <span
            style={{
              width: 42,
              height: 42,
              borderRadius: 42,
              background: C.ink,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Glyph name="arrowUp" size={22} color="#fff" stroke={2.4} />
          </span>
        </div>
      </div>
    </Panel>
  );
}

/** The four panels side by side: the whole app in one strip. */
export function AppStrip({ style }: { style?: CSSProperties }) {
  return (
    <div
      style={{
        position: "absolute",
        display: "flex",
        gap: PANEL.gap,
        width: STRIP_WIDTH,
        ...style,
      }}
    >
      <BrainPanel />
      <StudioPanel />
      <VisibilityPanel />
      <ChatPanel />
    </div>
  );
}
