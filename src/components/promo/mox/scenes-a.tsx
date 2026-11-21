import { PlatformAppIcon, type PlatformAppIconId } from "@/components/brand/PlatformAppIcon";
import { clamp01, easeInOut, easeOutBack, lerp, move, progress } from "@/lib/promo/timeline";
import { hasMedia, rand } from "@/lib/promo/mox-timeline";
import {
  Center,
  GlassBars,
  GlowCard,
  GradientText,
  H,
  Icon,
  Line,
  M,
  MoxLockup,
  Pic,
  Pill,
  Rise,
  Seq,
  Typed,
  W,
  WordList,
  type SceneProps,
} from "./parts";

/** Real Mellox posts (the landing page's wall), each shown at or under its own size. */
const wall = (name: string) => `/Home/wall/${name}.webp`;
const ORBIT = ["burger-1", "sunscreen-1", "wallet-1", "milk-1", "build-1", "finance-1", "classes-1", "burger-4"]; // prettier-ignore
const FEED = [
  ["burger-1", "finance-2", "milk-2", "build-3", "classes-4", "sunscreen-2"],
  ["wallet-2", "classes-1", "burger-3", "finance-4", "milk-3", "build-5"],
  ["sunscreen-3", "build-1", "wallet-3", "burger-5", "classes-2", "finance-1"],
  ["milk-1", "burger-2", "finance-5", "sunscreen-4", "build-2", "classes-5"],
  ["classes-3", "wallet-1", "sunscreen-5", "milk-4", "burger-6", "finance-3"],
  ["build-4", "sunscreen-1", "classes-6", "wallet-4", "finance-6", "burger-4"],
];

const ORB_MASK = "radial-gradient(circle 263px at 638px 355px, #000 97%, transparent 100%)";

/** What circles the orb: the places a brand shows up, and the reactions it gets. */
type WorldItem = { network: PlatformAppIconId } | { label: string; icon: "heart" | "send" | "eye" };
const WORLD: WorldItem[] = [
  { network: "instagram" },
  { label: "12.4k", icon: "heart" },
  { network: "tiktok" },
  { network: "youtube" },
  { label: "Shared", icon: "send" },
  { network: "linkedin" },
  { network: "facebook" },
  { label: "48k views", icon: "eye" },
];

function WorldChip({
  item,
  angle,
  lt,
  at,
}: {
  item: WorldItem;
  angle: number;
  lt: number;
  at: number;
}) {
  const depth = Math.sin(angle);
  const near = (depth + 1) / 2;
  const pop = easeOutBack(progress(lt, at, 0.5));
  return (
    <div
      style={{
        position: "absolute",
        left: W / 2 + Math.cos(angle) * 610,
        top: 600 + depth * 120,
        opacity: progress(lt, at, 0.2) * lerp(0.6, 1, near),
        transform: `translate(-50%, -50%) scale(${(lerp(0.76, 1.12, near) * lerp(0.3, 1, pop)).toFixed(4)})`,
      }}
    >
      {"network" in item ? (
        <PlatformAppIcon platform={item.network} size={96} />
      ) : (
        <Pill size={34}>
          <Icon
            name={item.icon}
            size={32}
            color={item.icon === "heart" ? "#f0447a" : M.ink}
            fill={item.icon === "heart" ? "#f0447a" : "none"}
            stroke={item.icon === "heart" ? 0 : 2.2}
          />
          {item.label}
        </Pill>
      )}
    </div>
  );
}

/* 1. "You built something. A brand. A product. A dream worth showing the world." */

export function BuiltScene({ lt }: SceneProps) {
  const BRAND = 2.8;
  const PRODUCT = 4.4;
  const DREAM = 6.0;
  const ORB = DREAM + 1.15;

  const grow = easeOutBack(progress(lt, 0, 0.8));
  const collapse = easeInOut(progress(lt, 1.2, 0.5));
  const openOut = progress(lt, BRAND - 0.3, 0.3);
  const dreamIn = move(lt, DREAM, 0.8);

  return (
    <>
      {lt < BRAND ? (
        <>
          <GlassBars
            lt={lt}
            w={lerp(1240, 640, collapse) * grow}
            h={lerp(660, 200, collapse) * grow}
            spread={1 - collapse}
            opacity={(1 - collapse) * (1 - openOut)}
          />
          <Center style={{ opacity: 1 - openOut }}>
            <div
              style={{
                position: "absolute",
                width: 640,
                height: 168,
                borderRadius: 999,
                backgroundImage: M.backdrop,
                opacity: collapse,
                transform: `scale(${lerp(1.5, 1, collapse).toFixed(4)})`,
                boxShadow: "0 30px 80px -30px rgba(46,230,107,0.7)",
              }}
            />
            <div
              style={{
                position: "absolute",
                fontSize: 150,
                fontWeight: 600,
                letterSpacing: "-0.035em",
                color: M.ink,
                opacity: 1 - progress(lt, 1.1, 0.2),
              }}
            >
              <Typed text="You built" p={progress(lt, 0.3, 0.45)} />
            </div>
            <div
              style={{
                position: "absolute",
                fontSize: 96,
                fontWeight: 600,
                letterSpacing: "-0.03em",
                color: M.ink,
                opacity: progress(lt, 1.45, 0.1),
              }}
            >
              <Typed text="something" p={progress(lt, 1.35, 0.4)} />
            </div>
          </Center>
        </>
      ) : null}

      {lt >= BRAND - 0.1 && lt < DREAM + 0.7
        ? ORBIT.map((name, i) => {
            const angle = (i / ORBIT.length) * Math.PI * 2 + (lt - BRAND) * 0.2 + 0.35;
            const leave = easeInOut(progress(lt, DREAM - 0.1, 0.7));
            const reach = 1 + leave * 0.9;
            const size = 190 + rand(i) * 70;
            const pop = easeOutBack(progress(lt, BRAND + i * 0.06, 0.55));
            return (
              <Pic
                key={name}
                src={wall(name)}
                w={size}
                h={size}
                radius={36}
                style={{
                  position: "absolute",
                  left: W / 2 + Math.cos(angle) * 770 * reach - size / 2,
                  top: H / 2 + Math.sin(angle) * 380 * reach - size / 2,
                  opacity: progress(lt, BRAND + i * 0.06, 0.2) * (1 - leave),
                  transform: `scale(${lerp(0.4, 1, pop).toFixed(4)}) rotate(${((rand(i + 9) - 0.5) * 10).toFixed(2)}deg)`,
                }}
              />
            );
          })
        : null}

      {lt >= BRAND && lt < DREAM + 0.3 ? (
        <Center>
          <Rise lt={lt} at={BRAND + 0.05} out={PRODUCT - 0.25} style={{ position: "absolute" }}>
            <div style={{ fontSize: 190, fontWeight: 600, letterSpacing: "-0.04em" }}>A brand.</div>
          </Rise>
          <Rise lt={lt} at={PRODUCT} out={DREAM - 0.25} style={{ position: "absolute" }}>
            <div style={{ fontSize: 190, fontWeight: 600, letterSpacing: "-0.04em" }}>
              A product.
            </div>
          </Rise>
        </Center>
      ) : null}

      {lt >= DREAM ? (
        <>
          {/* The world: a glossy orb with the places a brand shows up circling it. */}
          {lt >= ORB - 0.1
            ? WORLD.map((item, i) => {
                const angle = (i / WORLD.length) * Math.PI * 2 + (lt - ORB) * 0.55;
                const depth = Math.sin(angle);
                if (depth >= 0) return null;
                return <WorldChip key={i} item={item} angle={angle} lt={lt} at={ORB + 0.25 + i * 0.07} />; // prettier-ignore
              })
            : null}
          {lt >= ORB - 0.1 ? (
            <div
              style={{
                position: "absolute",
                left: W / 2 - 640,
                top: 600 - 360,
                width: 1280,
                height: 720,
                opacity: progress(lt, ORB, 0.25),
                transform: `scale(${lerp(0.4, 1, easeOutBack(progress(lt, ORB, 0.8))).toFixed(4)})`,
              }}
            >
              {hasMedia("clip-orb") ? (
                <Seq
                  name="clip-orb"
                  seconds={lt - ORB}
                  loop
                  still=""
                  w={1280}
                  h={720}
                  style={{
                    background: "transparent",
                    // Only the sphere: the studio backdrop around it is masked away.
                    WebkitMaskImage: ORB_MASK,
                    maskImage: ORB_MASK,
                  }}
                />
              ) : (
                <div
                  style={{
                    position: "absolute",
                    left: 640 - 250,
                    top: 360 - 250,
                    width: 500,
                    height: 500,
                    borderRadius: "50%",
                    backgroundImage: `radial-gradient(38% 30% at 34% 26%, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0) 100%), ${M.backdrop}`,
                    boxShadow:
                      "inset -30px -40px 90px rgba(14,80,140,0.35), 0 60px 90px -40px rgba(30,123,245,0.5)",
                    transform: `rotate(${((lt - ORB) * 14).toFixed(2)}deg)`,
                  }}
                />
              )}
            </div>
          ) : null}
          {lt >= ORB - 0.1
            ? WORLD.map((item, i) => {
                const angle = (i / WORLD.length) * Math.PI * 2 + (lt - ORB) * 0.55;
                if (Math.sin(angle) < 0) return null;
                return <WorldChip key={i} item={item} angle={angle} lt={lt} at={ORB + 0.25 + i * 0.07} />; // prettier-ignore
              })
            : null}

          <Center
            style={{
              justifyContent: "flex-start",
              paddingTop: lerp(300, 34, easeInOut(progress(lt, ORB - 0.15, 0.7))),
            }}
          >
            <div
              style={{
                opacity: dreamIn,
                transform: `scale(${(lerp(1.45, 1, dreamIn) * lerp(1, 0.4, easeInOut(progress(lt, ORB - 0.15, 0.7)))).toFixed(4)})`,
                transformOrigin: "50% 0%",
                filter: dreamIn < 0.99 ? `blur(${((1 - dreamIn) * 18).toFixed(2)}px)` : undefined,
              }}
            >
              <GradientText
                style={{
                  fontSize: 400,
                  fontWeight: 700,
                  letterSpacing: "-0.05em",
                  lineHeight: 1.1,
                }}
              >
                A dream
              </GradientText>
            </div>
          </Center>
          <div style={{ position: "absolute", left: 0, right: 0, top: 946, textAlign: "center" }}>
            <Line
              lt={lt}
              at={DREAM + 1.35}
              text="worth showing the world."
              size={78}
              style={{ display: "inline-block" }}
            />
          </div>
        </>
      ) : null}
    </>
  );
}

/* 2. "But the world scrolls fast. And showing up every single day is a full-time
      job. Ideas. Captions. Designs. Videos. Schedules. It never stops. And you're tired." */

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CHORES = ["Ideas", "Captions", "Designs", "Videos", "Schedules", "Hashtags", "Trends", "Replies", "Reels", "Stories"]; // prettier-ignore

export function PressureScene({ lt }: SceneProps) {
  const WEEK = 3.2;
  const CHORE = 8.3;
  const STOPS = 12.6;
  const TIRED = 14.6;

  const feedOut = progress(lt, WEEK - 0.35, 0.35);
  const weekOut = progress(lt, CHORE - 0.3, 0.3);
  const grey = easeInOut(progress(lt, STOPS - 0.2, 1.6));
  const run = Math.max(lt, 0);
  const scrolled = run * 620 + run * run * 260;

  return (
    <div style={{ position: "absolute", inset: 0, filter: `grayscale(${grey.toFixed(3)})` }}>
      {lt < WEEK ? (
        <div style={{ position: "absolute", inset: 0, opacity: 1 - feedOut }}>
          <div style={{ position: "absolute", inset: 0, filter: "blur(3px)" }}>
            {FEED.map((column, c) => {
              const period = column.length * 390;
              const offset = (scrolled * (0.75 + rand(c) * 0.6) + rand(c + 3) * period) % period;
              return [0, 1].map((copy) =>
                column.map((name, r) => (
                  <Pic
                    key={`${c}-${copy}-${r}`}
                    src={wall(name)}
                    w={280}
                    h={360}
                    radius={32}
                    style={{
                      position: "absolute",
                      left: 20 + c * 320,
                      top: r * 390 + copy * period - offset,
                      boxShadow: "none",
                    }}
                  />
                )),
              );
            })}
          </div>
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage:
                "linear-gradient(180deg, #fff 0%, rgba(255,255,255,0.35) 26%, rgba(255,255,255,0.35) 74%, #fff 100%)",
            }}
          />
          <Center>
            <Rise lt={lt} at={0.35} pop>
              <Pill size={84} style={{ boxShadow: M.shadow }}>
                <Typed text="The world scrolls fast." p={progress(lt, 0.5, 0.7)} />
              </Pill>
            </Rise>
          </Center>
        </div>
      ) : null}

      {lt >= WEEK && lt < CHORE ? (
        <div style={{ position: "absolute", inset: 0, opacity: 1 - weekOut }}>
          <GlassBars
            lt={lt}
            cy={520}
            w={1700}
            h={620}
            bars={11}
            spread={0.95}
            opacity={move(lt, WEEK, 0.7) * 0.85}
          />
          <Center>
            <Line lt={lt} at={WEEK + 0.1} text="Showing up" size={64} />
            <div style={{ display: "flex", gap: 54, marginTop: 26 }}>
              {["Every.", "Single.", "Day."].map((word, i) => (
                <Rise key={word} lt={lt} at={WEEK + 1.15 + i * 0.55} y={70}>
                  <div style={{ fontSize: 216, fontWeight: 700, letterSpacing: "-0.045em" }}>
                    {word}
                  </div>
                  <div
                    style={{
                      height: 14,
                      marginTop: -8,
                      borderRadius: 14,
                      backgroundImage: M.backdrop,
                      transformOrigin: "0% 50%",
                      transform: `scaleX(${move(lt, WEEK + 1.4 + i * 0.55, 0.5).toFixed(4)})`,
                    }}
                  />
                </Rise>
              ))}
            </div>
            <div style={{ display: "flex", gap: 24, marginTop: 56 }}>
              {DAYS.map((day, i) => {
                const at = WEEK + 1.15 + Math.floor((i * 3) / 7) * 0.55 + (i % 3) * 0.1;
                const pop = easeOutBack(progress(lt, at, 0.45));
                return (
                  <div
                    key={day}
                    style={{
                      width: 204,
                      height: 168,
                      borderRadius: 32,
                      background: M.white,
                      boxShadow: M.shadow,
                      padding: 20,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      opacity: progress(lt, at, 0.2),
                      transform: `scale(${lerp(0.7, 1, pop).toFixed(4)})`,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          backgroundImage: M.backdrop,
                        }}
                      />
                      <span style={{ fontSize: 30, fontWeight: 600 }}>{day}</span>
                    </div>
                    <Pill
                      size={22}
                      tone="mox"
                      style={{ alignSelf: "flex-start", boxShadow: "none" }}
                    >
                      Post due
                    </Pill>
                  </div>
                );
              })}
            </div>
            <Line
              lt={lt}
              at={WEEK + 3.3}
              text="is a full-time job."
              size={84}
              style={{ marginTop: 54 }}
            />
          </Center>
        </div>
      ) : null}

      {lt >= CHORE ? (
        <>
          <div
            style={{
              position: "absolute",
              inset: 0,
              opacity: lerp(1, 0.07, easeInOut(progress(lt, STOPS - 0.3, 0.5))),
              filter: lt > STOPS - 0.3 ? "blur(7px)" : undefined,
            }}
          >
            {Array.from({ length: 60 }, (_, i) => {
              const time = Math.min(lt, STOPS + 1.2) - CHORE;
              const offset = time * 1.5 + time * time * 0.42;
              const d = i - offset;
              if (Math.abs(d) > 5.2) return null;
              const near = Math.abs(d) < 0.5;
              return (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: H / 2 - 62 + d * 124,
                    height: 124,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 26,
                    fontSize: near ? 108 : 92,
                    fontWeight: 600,
                    letterSpacing: "-0.035em",
                    color: near ? M.ink : M.soft,
                    opacity: clamp01(1.15 - Math.abs(d) * 0.24) * progress(lt, CHORE, 0.3),
                  }}
                >
                  {near ? (
                    <span
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: "50%",
                        backgroundImage: M.backdrop,
                      }}
                    />
                  ) : null}
                  {CHORES[i % CHORES.length]}
                </div>
              );
            })}
          </div>
          <div
            style={{ position: "absolute", inset: 0, background: `rgba(118,124,130,${(grey * 0.16).toFixed(3)})` }} // prettier-ignore
          />
          <Center>
            <Line
              lt={lt}
              at={STOPS}
              out={TIRED - 0.3}
              text="It never stops."
              size={150}
              weight={700}
              style={{ position: "absolute" }}
            />
            <Line
              lt={lt}
              at={TIRED}
              text="And you're tired."
              size={96}
              gap={0.2}
              color={M.mute}
              style={{ position: "absolute", top: hasMedia("clip-tired") ? 838 : undefined }}
            />
            {hasMedia("clip-tired") && lt >= TIRED - 0.1 ? (
              <Rise lt={lt} at={TIRED - 0.1} y={30} style={{ position: "absolute", top: 110 }}>
                <Seq
                  name="clip-tired"
                  seconds={lt - TIRED + 0.15}
                  still=""
                  w={1216}
                  h={684}
                  radius={44}
                  style={{ boxShadow: M.shadow }}
                />
              </Rise>
            ) : null}
          </Center>
        </>
      ) : null}
    </div>
  );
}

/* 3. "Meet Mox." */

export function MeetScene({ lt, len }: SceneProps) {
  const OPEN = 0.6;
  const iris = easeInOut(progress(lt, OPEN, 0.85));
  const end = progress(lt, len - 1.25, 0.4);
  const dot = 34 + Math.sin(lt * 7) * 6;
  return (
    <>
      <div style={{ position: "absolute", inset: 0, background: "#eceeef", opacity: 1 - iris }} />
      {lt < OPEN + 0.3 ? (
        <Center>
          <div
            style={{
              width: dot,
              height: dot,
              borderRadius: "50%",
              backgroundImage: M.backdrop,
              opacity: progress(lt, 0.15, 0.3),
              boxShadow: "0 0 60px 10px rgba(46,230,107,0.55)",
            }}
          />
        </Center>
      ) : null}
      <div
        style={{
          position: "absolute",
          inset: 0,
          clipPath: `circle(${(iris * 1180).toFixed(1)}px at 50% 50%)`,
        }}
      >
        <Seq
          name="clip-meet"
          seconds={lt - OPEN}
          still="/promo-mox/still/meet.jpg"
          w={W}
          h={H}
          style={{ transform: `scale(${lerp(1.08, 1, iris).toFixed(4)})` }}
        />
        <div style={{ position: "absolute", left: 150, top: 330 }}>
          <Line lt={lt} at={OPEN + 0.8} text="Meet" size={150} weight={600} />
          <Line lt={lt} at={OPEN + 1.1} text="Mox." size={300} weight={700} />
        </div>
      </div>
      {end > 0 ? (
        <Center style={{ background: M.white, opacity: end }}>
          <Rise lt={lt} at={len - 1.1} pop>
            <MoxLockup size={150} />
          </Rise>
        </Center>
      ) : null}
    </>
  );
}

/* 4. "Drop in your website, and watch Mox learn your brand. Your look. Your
      voice. Your customers." */

const SAMPLE = { url: "yourbrand.com", colours: ["#E4572E", "#F3A712", "#2E282A", "#FFF1DC"] };
const GROUPS = [
  { name: "Late-night foodies", share: 0.86 },
  { name: "Office lunch crowd", share: 0.64 },
  { name: "Weekend families", share: 0.47 },
];
/** The four brains with their real logos (public/brains) in their own colours. */
const BRAINS = [
  { name: "Brand", logo: "/brains/brand.svg", color: "#B489D1" },
  { name: "Audience", logo: "/brains/customer.svg", color: "#0756E7" },
  { name: "Competitors", logo: "/brains/competitor.svg", color: "#EE3445" },
  { name: "Market", logo: "/brains/market.svg", color: "#FE7032" },
];

export function LearnScene({ lt }: SceneProps) {
  const SCAN = 2.2;
  const LOOK = 5.0;
  const VOICE = 6.5;
  const WHO = 8.0;
  const BRAIN = 9.6;

  const lift = easeInOut(progress(lt, LOOK - 0.7, 0.7));
  const press = progress(lt, 1.75, 0.12) * (1 - progress(lt, 1.9, 0.15));
  const sweep = progress(lt, SCAN, 1.9);
  const pillW = 980;
  const pillY = lerp(430, 96, lift);
  const pillScale = lerp(1, 0.56, lift);

  const cardStyle = (at: number, index: number) => {
    const pop = easeOutBack(progress(lt, at, 0.55));
    return {
      position: "absolute" as const,
      left: 132 + index * 566,
      top: 250,
      width: 524,
      height: 560,
      borderRadius: 44,
      background: M.white,
      border: `1.5px solid ${M.line}`,
      boxShadow: M.shadow,
      padding: 40,
      opacity: progress(lt, at, 0.2),
      transform: `translateY(${((1 - pop) * 60).toFixed(2)}px) scale(${lerp(0.9, 1, pop).toFixed(4)})`,
    };
  };
  const title = { fontSize: 58, fontWeight: 600, letterSpacing: "-0.03em", marginBottom: 30 };

  return (
    <>
      <GlassBars
        lt={lt}
        cy={pillY + 60}
        w={lerp(1500, 900, lift)}
        h={lerp(420, 200, lift)}
        spread={0.9}
        opacity={move(lt, 0, 0.6) * lerp(1, 0.55, lift)}
      />
      <Center style={{ justifyContent: "flex-start", paddingTop: 300, opacity: 1 - lift }}>
        <Line lt={lt} at={0.15} text="Drop in your website" size={62} color={M.mute} />
      </Center>

      <img
        src="/brand/mox/visor.webp"
        alt=""
        style={{
          position: "absolute",
          left: W / 2 - 330,
          top: lerp(H, 590, move(lt, SCAN - 0.4, 0.7)) + lift * 600,
          width: 660,
          height: 490,
          objectFit: "contain",
        }}
      />

      <div
        style={{
          position: "absolute",
          left: W / 2 - pillW / 2,
          top: pillY,
          width: pillW,
          height: 136,
          borderRadius: 999,
          background: M.white,
          border: `2px solid ${M.line}`,
          boxShadow: M.shadow,
          display: "flex",
          alignItems: "center",
          padding: "0 22px 0 56px",
          fontSize: 62,
          fontWeight: 500,
          letterSpacing: "-0.02em",
          overflow: "hidden",
          opacity: move(lt, 0.1, 0.4),
          transform: `scale(${pillScale.toFixed(4)})`,
          transformOrigin: "50% 0%",
        }}
      >
        <div style={{ flex: 1 }}>
          <Typed text={SAMPLE.url} p={progress(lt, 0.6, 1.0)} />
        </div>
        <div
          style={{
            width: 98,
            height: 98,
            borderRadius: "50%",
            backgroundImage: M.gradient,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transform: `scale(${(1 - press * 0.16).toFixed(4)})`,
          }}
        >
          <Icon name="arrow" size={50} color={M.ink} stroke={2.6} />
        </div>
        {sweep > 0 && sweep < 1 ? (
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: lerp(-240, pillW, sweep),
              width: 240,
              backgroundImage:
                "linear-gradient(90deg, rgba(46,230,107,0) 0%, rgba(46,230,107,0.42) 50%, rgba(25,214,230,0) 100%)",
            }}
          />
        ) : null}
      </div>

      {lt >= LOOK - 0.1 ? (
        <>
          <div style={cardStyle(LOOK, 0)}>
            <div style={title}>Your look</div>
            <div style={{ display: "flex", gap: 18 }}>
              {SAMPLE.colours.map((colour, i) => (
                <Rise key={colour} lt={lt} at={LOOK + 0.25 + i * 0.08} pop y={0}>
                  <div
                    style={{
                      width: 92,
                      height: 92,
                      borderRadius: "50%",
                      background: colour,
                      border: `1.5px solid ${M.line}`,
                    }}
                  />
                </Rise>
              ))}
            </div>
            <div style={{ display: "flex", gap: 18, marginTop: 34, alignItems: "flex-end" }}>
              <Rise lt={lt} at={LOOK + 0.6} y={20}>
                <Pic src={wall("burger-1")} w={200} h={250} radius={26} />
              </Rise>
              <Rise lt={lt} at={LOOK + 0.72} y={20}>
                <Pic src={wall("burger-3")} w={200} h={250} radius={26} />
              </Rise>
            </div>
          </div>

          <div style={cardStyle(VOICE, 1)}>
            <div style={title}>Your voice</div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              {["Playful", "Bold", "Warm"].map((tone, i) => (
                <Rise key={tone} lt={lt} at={VOICE + 0.25 + i * 0.1} pop y={0}>
                  <Pill size={32} tone={i === 0 ? "mox" : "white"} style={{ boxShadow: "none" }}>
                    {tone}
                  </Pill>
                </Rise>
              ))}
            </div>
            <div
              style={{
                marginTop: 40,
                fontSize: 46,
                fontWeight: 500,
                lineHeight: 1.22,
                letterSpacing: "-0.02em",
                whiteSpace: "pre-wrap",
              }}
            >
              <Typed
                text={"Smash. Sizzle. Stack.\nFridays just got louder."}
                p={progress(lt, VOICE + 0.5, 1.3)}
              />
            </div>
          </div>

          <div style={cardStyle(WHO, 2)}>
            <div style={title}>Your customers</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 34 }}>
              {GROUPS.map((group, i) => {
                const fill = move(lt, WHO + 0.3 + i * 0.14, 0.9);
                return (
                  <div key={group.name}>
                    <div style={{ fontSize: 36, fontWeight: 600, letterSpacing: "-0.02em" }}>
                      {group.name}
                    </div>
                    <div
                      style={{ marginTop: 14, height: 20, borderRadius: 20, background: M.wash }}
                    >
                      <div
                        style={{
                          width: `${group.share * fill * 100}%`,
                          height: 20,
                          borderRadius: 20,
                          backgroundImage: M.gradient,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 880,
              display: "flex",
              justifyContent: "center",
              gap: 26,
            }}
          >
            {BRAINS.map((brain, i) => (
              <Rise key={brain.name} lt={lt} at={BRAIN + i * 0.14} pop>
                <Pill size={38} style={{ paddingLeft: 18 }}>
                  <span
                    style={{
                      width: 56,
                      height: 56,
                      backgroundColor: brain.color,
                      WebkitMask: `url(${brain.logo}) center / contain no-repeat`,
                      mask: `url(${brain.logo}) center / contain no-repeat`,
                    }}
                  />
                  {brain.name}
                  <Icon name="check" size={36} color={M.teal} stroke={3} />
                </Pill>
              </Rise>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

/* 5. "Then it gets to work. Posts, carousels, stories, videos, whole campaigns.
      Made, scheduled and published, on autopilot." */

const KINDS = ["Posts", "Carousels", "Stories", "Videos", "Campaigns"];
const NETWORKS: PlatformAppIconId[] = ["instagram", "tiktok", "facebook", "linkedin", "youtube", "twitter"]; // prettier-ignore
const WALL_PICS = ["sunscreen-1", "burger-2", "finance-1", "build-2", "milk-1", "classes-3", "wallet-2", "sunscreen-4", "burger-5", "finance-4", "build-6", "milk-3", "classes-1", "wallet-4", "sunscreen-2", "burger-1", "finance-6", "build-4", "milk-4", "classes-5", "wallet-1", "sunscreen-6", "burger-3", "finance-2"]; // prettier-ignore
const WALL_REELS = { 3: "reel-1", 10: "skin-fix", 13: "reel-2", 20: "website-losing-customers", 25: "reel-4", 30: "reel-3", 37: "reel-1", 44: "skin-fix" } as const; // prettier-ignore

function KindCard({ kind, lt, since }: { kind: number; lt: number; since: number }) {
  const local = lt - since;
  if (kind === 0)
    return (
      <Center>
        <Pic src={wall("sunscreen-1")} w={560} h={690} radius={0} style={{ boxShadow: "none" }} />
      </Center>
    );
  if (kind === 1) {
    const slide = easeInOut(progress(local, 0.3, 0.4)) + easeInOut(progress(local, 0.75, 0.35));
    return (
      <>
        <div
          style={{
            position: "absolute",
            left: 60 - slide * 500,
            top: 70,
            display: "flex",
            gap: 20,
          }}
        >
          {["build-1", "build-2", "build-3", "build-4"].map((name) => (
            <Pic key={name} src={wall(name)} w={480} h={480} radius={30} />
          ))}
        </div>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 52,
            display: "flex",
            justifyContent: "center",
            gap: 14,
          }}
        >
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              style={{
                width: i === Math.round(slide) ? 44 : 16,
                height: 16,
                borderRadius: 16,
                background: i === Math.round(slide) ? M.ink : M.line,
              }}
            />
          ))}
        </div>
      </>
    );
  }
  if (kind === 2 || kind === 3) {
    const name = kind === 2 ? "reel-1" : "skin-fix";
    return (
      <Center style={{ background: M.wash }}>
        <div style={{ position: "relative" }}>
          <Seq
            name={name}
            seconds={local + (kind === 2 ? 2.2 : 0.4)}
            loop
            still={wall(name)}
            w={378}
            h={672}
            radius={34}
            style={{ boxShadow: M.shadowSoft }}
          />
          {kind === 2 ? (
            <div
              style={{
                position: "absolute",
                left: 18,
                right: 18,
                top: 18,
                display: "flex",
                gap: 8,
              }}
            >
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    height: 7,
                    borderRadius: 7,
                    background: "rgba(255,255,255,0.45)",
                  }}
                >
                  <div
                    style={{
                      width: `${clamp01(local * 1.6 - i) * 100}%`,
                      height: 7,
                      borderRadius: 7,
                      background: "#fff",
                    }}
                  />
                </div>
              ))}
            </div>
          ) : (
            <Pill size={26} tone="ink" style={{ position: "absolute", left: 18, bottom: 18 }}>
              <Icon name="play" size={22} color="#fff" fill="#fff" stroke={0} />
              Video
            </Pill>
          )}
        </div>
      </Center>
    );
  }
  const phases = [
    { name: "Tease", from: 0, to: 4, row: 0, fill: M.lime },
    { name: "Launch day", from: 2, to: 6, row: 1, fill: M.green },
    { name: "Keep it going", from: 0, to: 5, row: 2, fill: M.cyan },
  ];
  return (
    <div style={{ position: "absolute", inset: 0, padding: 48 }}>
      <div style={{ fontSize: 44, fontWeight: 600, letterSpacing: "-0.03em" }}>Summer launch</div>
      <div style={{ display: "flex", gap: 10, marginTop: 26 }}>
        {DAYS.map((day) => (
          <div key={day} style={{ width: 78, fontSize: 24, fontWeight: 600, color: M.mute }}>
            {day}
          </div>
        ))}
      </div>
      {phases.map((phase, i) => {
        const grow = move(local, 0.1 + i * 0.15, 0.5);
        return (
          <div key={phase.name} style={{ position: "relative", height: 150, marginTop: 14 }}>
            <div style={{ display: "flex", gap: 10 }}>
              {DAYS.map((day) => (
                <div
                  key={day}
                  style={{ width: 78, height: 150, borderRadius: 18, background: M.wash }}
                />
              ))}
            </div>
            <div
              style={{
                position: "absolute",
                left: phase.from * 88 + 8,
                top: 46,
                width: ((phase.to - phase.from + 1) * 88 - 26) * grow,
                height: 58,
                borderRadius: 58,
                background: phase.fill,
                display: "flex",
                alignItems: "center",
                paddingLeft: 24,
                fontSize: 28,
                fontWeight: 600,
                overflow: "hidden",
                whiteSpace: "nowrap",
              }}
            >
              {phase.name}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function CreateScene({ lt }: SceneProps) {
  const LIST = 2.6;
  // Each kind lights up as it is said.
  const STARTS = [0.4, 1.7, 3.0, 4.3, 5.6].map((at) => LIST + at);
  const GENERATE = LIST + 7.4;
  const FLY = GENERATE + 1.4;
  const DONE = FLY + 2.8;

  const kind = Math.max(0, STARTS.filter((at) => lt >= at).length - 1);
  const since = STARTS[kind];
  const swap = move(lt, since, 0.25);
  const listOut = progress(lt, GENERATE - 0.3, 0.3);
  const fly = easeInOut(progress(lt, FLY, DONE - FLY + 2.3));
  const veil = easeInOut(progress(lt, DONE - 0.2, 0.6));

  return (
    <>
      {lt < LIST ? (
        <Center>
          <Line
            lt={lt}
            at={0.25}
            out={LIST - 0.3}
            text="Then it gets to work."
            size={136}
            gap={0.16}
          />
        </Center>
      ) : null}

      {lt >= LIST - 0.05 && lt < GENERATE ? (
        <div style={{ position: "absolute", inset: 0, opacity: 1 - listOut }}>
          <WordList
            items={KINDS}
            active={kind}
            position={kind === 0 ? 0 : kind - 1 + easeInOut(progress(lt, since - 0.1, 0.5))}
            pulse={easeOutBack(progress(lt, since, 0.5))}
            x={170}
            lt={lt}
            at={LIST}
            size={104}
          />
          <div style={{ opacity: move(lt, LIST + 0.1, 0.5) }}>
            <GlowCard cx={1370} cy={540} w={680} h={760} lt={lt}>
              <div
                key={kind}
                style={{
                  position: "absolute",
                  inset: 0,
                  opacity: swap,
                  transform: `scale(${lerp(1.06, 1, swap).toFixed(4)})`,
                }}
              >
                <KindCard kind={kind} lt={lt} since={since} />
              </div>
            </GlowCard>
          </div>
        </div>
      ) : null}

      {lt >= GENERATE - 0.05 && lt < FLY + 0.4 ? (
        <Center style={{ opacity: 1 - progress(lt, FLY, 0.35) }}>
          <Rise lt={lt} at={GENERATE} style={{ display: "flex", alignItems: "center", gap: 30 }}>
            <img src="/brand/mox/visor-head.webp" alt="" width={150} height={150} />
            <GradientText
              style={{
                fontSize: 150,
                fontWeight: 600,
                letterSpacing: "-0.04em",
                backgroundSize: "220% 100%",
                backgroundPosition: `${(100 - progress(lt, GENERATE, 1.6) * 100).toFixed(1)}% 0`,
              }}
              fill={`linear-gradient(90deg, ${M.ink} 0%, ${M.ink} 38%, ${M.green} 50%, ${M.cyan} 56%, ${M.ink} 66%, ${M.ink} 100%)`}
            >
              Generating
            </GradientText>
          </Rise>
        </Center>
      ) : null}

      {lt >= FLY ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            perspective: 1700,
            opacity: progress(lt, FLY, 0.3) * lerp(1, 0.32, veil),
            filter: veil > 0.01 ? `blur(${(veil * 9).toFixed(2)}px)` : undefined,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: W / 2 - 1320,
              top: H / 2 - 1250,
              width: 2640,
              height: 2500,
              transformStyle: "preserve-3d",
              transform: `rotateX(34deg) rotateZ(-11deg) translate3d(${lerp(160, -220, fly).toFixed(1)}px, ${lerp(520, -420, fly).toFixed(1)}px, ${lerp(-520, 240, fly).toFixed(1)}px)`,
            }}
          >
            {Array.from({ length: 48 }, (_, i) => {
              const col = i % 8;
              const row = Math.floor(i / 8);
              const at = FLY + (col + (5 - row)) * 0.045;
              const pop = easeOutBack(progress(lt, at, 0.5));
              const reel = WALL_REELS[i as keyof typeof WALL_REELS];
              const box = {
                position: "absolute" as const,
                left: col * 330,
                top: row * 416 + (col % 2) * 120,
                opacity: progress(lt, at, 0.2),
                transform: `scale(${lerp(0.5, 1, pop).toFixed(4)})`,
              };
              return reel ? (
                <Seq
                  key={i}
                  name={reel}
                  seconds={lt - FLY}
                  loop
                  still={wall(reel)}
                  w={300}
                  h={386}
                  radius={34}
                  style={{ ...box, boxShadow: M.shadowSoft }}
                />
              ) : (
                <Pic
                  key={i}
                  src={wall(WALL_PICS[i % WALL_PICS.length])}
                  w={300}
                  h={386}
                  radius={34}
                  style={box}
                />
              );
            })}
          </div>
        </div>
      ) : null}

      {lt >= DONE - 0.2 ? (
        <Center style={{ gap: 44 }}>
          <div style={{ display: "flex", gap: 22 }}>
            {["Made", "Scheduled", "Published"].map((word, i) => (
              <Rise key={word} lt={lt} at={DONE + 0.1 + i * 0.7} pop>
                <Pill size={56}>
                  {word}
                  <Icon name="check" size={50} color={M.teal} stroke={3} />
                </Pill>
              </Rise>
            ))}
          </div>
          <div style={{ display: "flex", gap: 26 }}>
            {NETWORKS.map((network, i) => (
              <Rise key={network} lt={lt} at={DONE + 2.2 + i * 0.07} pop>
                <PlatformAppIcon platform={network} size={104} />
              </Rise>
            ))}
          </div>
          <Rise lt={lt} at={DONE + 2.9}>
            <div style={{ fontSize: 120, fontWeight: 700, letterSpacing: "-0.04em" }}>
              on <GradientText style={{ paddingRight: 8 }}>autopilot</GradientText>
            </div>
          </Rise>
        </Center>
      ) : null}
    </>
  );
}
