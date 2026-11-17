import { PLANS, PUBLIC_PLANS, creditsOf } from "@/lib/billing/catalog";
import { easeInOut, easeOut, easeOutBack, lerp, move, progress } from "@/lib/promo/timeline";
import { rand } from "@/lib/promo/mox-timeline";
import {
  Center,
  GlassBars,
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
  W,
  spaced,
  type SceneProps,
} from "./parts";

const wall = (name: string) => `/Home/wall/${name}.webp`;

/** White words that stay readable over footage. */
const onDark = { color: "#fff", textShadow: "0 6px 40px rgba(5,20,40,0.55)" } as const;
/** Ink words for bright footage (day sky, sunset), lifted off it by a soft light halo. */
const onBright = {
  color: M.ink,
  textShadow: "0 0 28px rgba(255,255,255,0.9), 0 0 70px rgba(255,255,255,0.7)",
} as const;

/* 6. "All day. All night." */

export function AlwaysScene({ lt }: SceneProps) {
  const NIGHT = 3.6;
  return (
    <>
      <Seq
        name="clip-always"
        seconds={lt - 0.3}
        still="/promo-mox/still/always.jpg"
        w={W}
        h={H}
        style={{ transform: `scale(${lerp(1.06, 1, easeOut(progress(lt, 0, 6))).toFixed(4)})` }}
      />
      <div style={{ position: "absolute", right: 150, top: 150, textAlign: "right" }}>
        <Line
          lt={lt}
          at={0.9}
          out={NIGHT - 0.6}
          text="All day."
          size={190}
          weight={700}
          style={{ ...onBright, position: "absolute", right: 0 }}
        />
        <Line
          lt={lt}
          at={NIGHT}
          text="All night."
          size={190}
          weight={700}
          style={{ ...onDark, position: "absolute", right: 0 }}
        />
      </div>
    </>
  );
}

/* 7. "Learning what your audience loves, and making more of it." */

const TRIED = [
  { pic: "burger-2", hearts: 214, sends: 12 },
  { pic: "burger-1", hearts: 1932, sends: 268 },
  { pic: "burger-3", hearts: 187, sends: 9 },
];
const MORE = ["burger-4", "burger-5", "burger-6"];

export function LoopScene({ lt }: SceneProps) {
  const WIN = 1.9;
  const MAKE = 3.3;
  const shift = easeInOut(progress(lt, MAKE - 0.4, 0.7));

  return (
    <>
      <Center style={{ justifyContent: "flex-start", paddingTop: 84 }}>
        <Line
          lt={lt}
          at={0.2}
          out={MAKE - 0.5}
          text="Learning what your audience loves"
          size={84}
          style={{ position: "absolute" }}
        />
        <Line
          lt={lt}
          at={MAKE - 0.1}
          text="and making more of it."
          size={84}
          style={{ position: "absolute" }}
        />
      </Center>

      {TRIED.map((post, i) => {
        const winner = i === 1;
        const won = move(lt, WIN, 0.5);
        const pop = easeOutBack(progress(lt, 0.3 + i * 0.12, 0.55));
        const counted = easeOut(progress(lt, 0.5, winner ? 1.3 : 0.8));
        const x = lerp(330 + i * 430, winner ? 150 : 330 + i * 430, shift);
        const size = winner ? lerp(400, 470, won) : 400;
        return (
          <div
            key={post.pic}
            style={{
              position: "absolute",
              left: x + (400 - size) / 2,
              top: 300 + (400 - size) / 2 + (winner ? 0 : 30 * won),
              opacity: progress(lt, 0.3 + i * 0.12, 0.2) * (winner ? 1 : lerp(1, 0.45, won) * (1 - shift)),
              transform: `scale(${lerp(0.7, 1, pop).toFixed(4)})`,
            }} // prettier-ignore
          >
            <div
              style={{
                padding: winner ? 9 * won : 0,
                borderRadius: 50,
                backgroundImage: winner ? M.backdrop : undefined,
                boxShadow: winner && won > 0.1 ? "0 30px 90px -20px rgba(46,230,107,0.75)" : undefined,
              }} // prettier-ignore
            >
              <Pic src={wall(post.pic)} w={size} h={size * 1.25} radius={42} />
            </div>
            <div style={{ display: "flex", gap: 14, marginTop: 22, justifyContent: "center" }}>
              <Pill size={34}>
                <Icon name="heart" size={32} color="#f0447a" fill="#f0447a" stroke={0} />
                {Math.round(post.hearts * counted).toLocaleString("en-US")}
              </Pill>
              <Pill size={34}>
                <Icon name="send" size={30} color={M.ink} />
                {Math.round(post.sends * counted)}
              </Pill>
            </div>
            {winner ? (
              <Rise
                lt={lt}
                at={WIN + 0.15}
                pop
                style={{ position: "absolute", left: -30, top: -34 }}
              >
                <Pill size={32} tone="mox">
                  Your audience loves this
                </Pill>
              </Rise>
            ) : null}
          </div>
        );
      })}

      {lt >= MAKE
        ? MORE.map((pic, i) => {
            const at = MAKE + 0.25 + i * 0.22;
            const pop = easeOutBack(progress(lt, at, 0.6));
            return (
              <div
                key={pic}
                style={{
                  position: "absolute",
                  left: lerp(520, 800 + i * 350, pop),
                  top: 330,
                  opacity: progress(lt, at, 0.2),
                  transform: `scale(${lerp(0.5, 1, pop).toFixed(4)}) rotate(${((1 - pop) * -14).toFixed(2)}deg)`,
                }}
              >
                <Pic src={wall(pic)} w={320} h={414} radius={38} />
                <Rise
                  lt={lt}
                  at={at + 0.3}
                  pop
                  style={{ position: "absolute", right: -18, top: -22 }}
                >
                  <Pill size={28} tone="ink">
                    New
                  </Pill>
                </Rise>
              </div>
            );
          })
        : null}
      {lt >= MAKE ? (
        <Rise lt={lt} at={MAKE + 0.1} style={{ position: "absolute", left: 660, top: 500 }}>
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: "50%",
              backgroundImage: M.gradient,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: M.shadowSoft,
            }}
          >
            <Icon name="arrow" size={52} color={M.ink} stroke={2.8} />
          </div>
        </Rise>
      ) : null}
    </>
  );
}

/* 8. "So while you build the business, your social media manager grows it." */

const ROLE: Array<{ word: string; face?: string }> = [
  { word: "Your", face: "/brand/mox/face-head.webp" },
  { word: "Social", face: "/brand/mox/visor-head.webp" },
  { word: "Media", face: "/brand/mox/face-head.webp" },
  { word: "Manager" },
];

export function PayoffScene({ lt }: SceneProps) {
  const ROLE_AT = 2.9;
  const NUMBER = 6.8;
  const firstOut = progress(lt, ROLE_AT - 0.35, 0.3);
  const roleOut = progress(lt, NUMBER - 0.35, 0.3);

  const run = lt - NUMBER;
  const views = lerp(1_204_300, 1_248_560, easeOut(progress(run, 0.2, 1.8))) + Math.max(0, Math.floor((run - 2) / 0.1)) * 37; // prettier-ignore

  return (
    <>
      {lt < ROLE_AT ? (
        <Center style={{ opacity: 1 - firstOut }}>
          <Line
            lt={lt}
            at={0.25}
            text="So while you build the business,"
            size={104}
            color={M.mute}
            gap={0.13}
          />
        </Center>
      ) : null}

      {lt >= ROLE_AT - 0.05 && lt < NUMBER ? (
        <Center style={{ opacity: 1 - roleOut }}>
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            {ROLE.map((part, i) => {
              const at = ROLE_AT + i * 0.4;
              const enter = move(lt, at, 0.45);
              const settle = progress(lt, at + 0.35, 0.4);
              const text = { fontSize: 112, fontWeight: 600, letterSpacing: "-0.04em", lineHeight: 1.1 }; // prettier-ignore
              return (
                <div key={part.word} style={{ display: "flex", alignItems: "center", gap: 22 }}>
                  <div
                    style={{
                      position: "relative",
                      opacity: enter,
                      transform: `translateY(${((1 - enter) * 30).toFixed(2)}px)`,
                    }}
                  >
                    <GradientText style={{ ...text, opacity: 1 - settle }}>
                      {part.word}
                    </GradientText>
                    <span
                      style={{
                        ...text,
                        position: "absolute",
                        left: 0,
                        top: 0,
                        color: M.ink,
                        opacity: settle,
                      }}
                    >
                      {part.word}
                    </span>
                  </div>
                  {part.face ? (
                    <img
                      src={part.face}
                      alt=""
                      width={104}
                      height={104}
                      style={{
                        opacity: progress(lt, at + 0.25, 0.2),
                        transform: `scale(${lerp(0.3, 1, easeOutBack(progress(lt, at + 0.25, 0.5))).toFixed(4)}) rotate(${((rand(i) - 0.5) * 16).toFixed(1)}deg)`,
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
          <Line lt={lt} at={ROLE_AT + 2.1} text="grows it." size={104} style={{ marginTop: 26 }} />
        </Center>
      ) : null}

      {lt >= NUMBER - 0.05 ? (
        <>
          {Array.from({ length: 16 }, (_, i) => {
            const rise = easeOut(progress(run, 0.1 + i * 0.05, 1.1));
            const height = (110 + i * 30 + rand(i + 2) * 90 + Math.max(run - 1.4, 0) * (3 + i * 2)) * rise; // prettier-ignore
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: i * 120 + 5,
                  bottom: 0,
                  width: 110,
                  height,
                  borderRadius: "30px 30px 0 0",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: -(i * 120 + 5),
                    bottom: 0,
                    width: W,
                    height: H,
                    backgroundImage: M.backdrop,
                  }}
                />
              </div>
            );
          })}
          <div style={{ position: "absolute", left: 0, right: 0, top: 150, textAlign: "center" }}>
            <Rise lt={lt} at={NUMBER + 0.1} pop style={{ display: "inline-block" }}>
              <Pill size={40}>
                <Icon name="eye" size={40} color={M.ink} />
                Views
                <Icon name="up" size={36} color={M.teal} stroke={3} />
              </Pill>
            </Rise>
            <div
              style={{
                marginTop: 10,
                fontSize: 330,
                fontWeight: 700,
                letterSpacing: "-0.05em",
                lineHeight: 1.05,
                fontVariantNumeric: "tabular-nums",
                color: M.ink,
                opacity: move(lt, NUMBER, 0.4),
                transform: `translateY(${((1 - move(lt, NUMBER, 0.5)) * 60).toFixed(2)}px)`,
              }}
            >
              {spaced(views)}
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}

/* 9. "From forty-nine dollars a month." */

export function PriceScene({ lt }: SceneProps) {
  const starter = PLANS.starter.priceMonthlyUsd;
  const shown = Math.round(starter * easeOut(progress(lt, 0.5, 1.0)));
  return (
    <>
      <GlassBars lt={lt} cy={470} w={1300} h={560} spread={0.8} opacity={move(lt, 0, 0.6) * 0.9} />
      <Center>
        <Line lt={lt} at={0.2} text="From" size={70} />
        <Rise lt={lt} at={0.35} y={60}>
          <div
            style={{
              fontSize: 380,
              fontWeight: 700,
              letterSpacing: "-0.055em",
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            ${shown}
            <span style={{ fontSize: 84, fontWeight: 600, letterSpacing: "-0.02em" }}> /month</span>
          </div>
        </Rise>
        <div style={{ display: "flex", gap: 22, marginTop: 70 }}>
          {PUBLIC_PLANS.map((id, i) => (
            <Rise key={id} lt={lt} at={2.3 + i * 0.14} pop>
              <Pill size={38} tone={i === 0 ? "ink" : "white"}>
                {PLANS[id].label} ·{" "}
                {creditsOf(PLANS[id].allowances.credits).toLocaleString("en-US")} credits
              </Pill>
            </Rise>
          ))}
        </div>
        <Rise lt={lt} at={3.3} pop style={{ marginTop: 34 }}>
          <Pill size={46} tone="mox">
            1 credit = 1 post
          </Pill>
        </Rise>
      </Center>
    </>
  );
}

/* 10. "Mellox. Social media on autopilot. Meet Mox today." */

export function FinaleScene({ lt, site }: SceneProps & { site: string }) {
  const CARD = 5.6;
  const card = easeInOut(progress(lt, CARD, 0.6));
  return (
    <>
      <Seq
        name="clip-finale"
        seconds={lt - 0.2}
        still="/promo-mox/still/finale.jpg"
        w={W}
        h={H}
        style={{ transform: `scale(${lerp(1.05, 1, easeOut(progress(lt, 0, 6))).toFixed(4)})` }}
      />
      <div style={{ position: "absolute", left: 140, top: 150, opacity: 1 - card }}>
        <Line lt={lt} at={2.2} text="Social media" size={150} weight={700} style={onBright} />
        <Line lt={lt} at={3.1} text="on autopilot." size={150} weight={700} style={onBright} />
      </div>
      {card > 0 ? (
        <Center style={{ background: M.white, opacity: card, gap: 44 }}>
          <GlassBars
            lt={lt}
            cy={600}
            w={1500}
            h={520}
            spread={0.9}
            opacity={move(lt, CARD + 0.2, 0.9) * 0.55}
          />
          <Rise lt={lt} at={CARD + 0.3} pop style={{ position: "relative" }}>
            <MoxLockup size={170} />
          </Rise>
          <Line
            lt={lt}
            at={CARD + 0.9}
            text="Social media on autopilot."
            size={92}
            style={{ position: "relative" }}
          />
          <Rise lt={lt} at={CARD + 2.0} pop style={{ position: "relative", marginTop: 10 }}>
            <Pill size={54} tone="mox" style={{ padding: "30px 56px" }}>
              Meet Mox today
              <Icon name="arrow" size={50} color={M.ink} stroke={2.8} />
            </Pill>
          </Rise>
          <Rise lt={lt} at={CARD + 2.4} style={{ position: "relative" }}>
            <div style={{ fontSize: 50, fontWeight: 600, letterSpacing: "-0.01em", color: M.ink }}>
              {site}
            </div>
          </Rise>
        </Center>
      ) : null}
    </>
  );
}
