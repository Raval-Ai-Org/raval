import { Sparkles } from "lucide-react";
import Link from "next/link";
import SectionHead from "@/components/pricing/SectionHead";
import { EXISTING_CONNECTORS, MELLOX2, NEW_CONNECTORS, type Mellox2Section } from "@/lib/mellox2";
import "./mellox2.css";

/* Needs the `.px` wrapper (pricing.css) for its tokens, like WhatsNew. */

function Badges({ s }: { s: Mellox2Section }) {
  return (
    <span className="m2-badges">
      <span className="m2-badge">New</span>
      {s.beta && <span className="m2-badge m2-beta">Beta</span>}
    </span>
  );
}

/** Home page: Mox as the main visual, then a card for every Mellox 2.0 feature. */
export function Mellox2Home() {
  return (
    <section id="mellox-2" className="px-section m2">
      <div className="px-inner">
        <div className="m2-hero" data-reveal>
          <div className="m2-hero-copy">
            <p className="m2-pill">Mellox 2.0</p>
            <h2>Meet Mox, your guide through Mellox.</h2>
            <p>
              A new look, a simpler app and a 3D character who greets you, chats, runs your onboarding and keeps you company while Mellox works.
            </p>
            <Link href="/features/mellox-2" className="m2-cta">
              See everything new <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div className="m2-hero-art">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/mox/hero-gradient.webp" alt="Mox, the Mellox 3D character, smiling" width={560} height={560} />
          </div>
        </div>

        <SectionHead
          icon={<Sparkles size={32} strokeWidth={1.4} aria-hidden="true" />}
          label="New in Mellox 2.0"
          title="Everything we shipped, in one app."
          blurb="Campaigns, Inspo, video, creator ads, posters, analytics and more."
          wide
        />
        <div className="m2-grid">
          {MELLOX2.filter((s) => s.id !== "mox").map((s, i) => {
            const Icon = s.icon;
            return (
              <Link key={s.id} href={`/features/mellox-2#${s.id}`} className="px-card m2-card" data-reveal style={{ transitionDelay: `${(i % 3) * 70}ms` }}>
                <div className="m2-card-top">
                  <span className="m2-icon">
                    <Icon size={22} strokeWidth={1.7} aria-hidden="true" />
                  </span>
                  <Badges s={s} />
                </div>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** Full sections for /features: one block per feature, with Mox art where we have it. */
export function Mellox2Sections() {
  return (
    <>
      {MELLOX2.map((s, i) => {
        const Icon = s.icon;
        return (
          <section key={s.id} id={s.id} className="px-section m2">
            <div className="px-inner">
              <div className={`m2-row${i % 2 ? " m2-flip" : ""}`} data-reveal>
                <div className="m2-row-copy">
                  <div className="m2-row-head">
                    <span className="m2-icon">
                      <Icon size={24} strokeWidth={1.7} aria-hidden="true" />
                    </span>
                    <Badges s={s} />
                  </div>
                  <h2>{s.title}</h2>
                  <p className="m2-lede">{s.text}</p>
                  <ul>
                    {s.points.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
                {s.img && (
                  <div className="m2-row-art">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.img} alt="" width={460} height={520} loading="lazy" />
                  </div>
                )}
              </div>
            </div>
          </section>
        );
      })}
    </>
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2);
}

function Logo({ name, logo, image }: { name: string; logo?: string; image?: string }) {
  return (
    <span className="m2-logo">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" width={34} height={34} />
      ) : logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/llms/${logo}.svg`} alt="" width={28} height={28} />
      ) : (
        <span className="m2-mono" aria-hidden="true">
          {initials(name)}
        </span>
      )}
    </span>
  );
}

/** Logo grid for the integrations page: new connectors, coming soon, and the ones already live. */
export function ConnectorGrid() {
  const live = NEW_CONNECTORS.filter((c) => c.status === "live");
  const soon = NEW_CONNECTORS.filter((c) => c.status === "soon");
  return (
    <section id="new-connectors" className="px-section m2">
      <div className="px-inner">
        <p className="px-label">New connectors</p>
        <div className="px-rule" />
        <div className="ft-head" data-reveal>
          <h2>New connectors in Mellox 2.0</h2>
          <p>Publish, edit, save and track with the apps your team already uses.</p>
        </div>
        <div className="m2-logos">
          {live.map((c) => (
            <div key={c.name} className="m2-tile" data-reveal>
              <Logo name={c.name} logo={c.logo} image={c.image} />
              <h3>{c.name}</h3>
              <p>{c.text}</p>
            </div>
          ))}
        </div>

        <h3 className="m2-sub">Coming soon</h3>
        <div className="m2-logos">
          {soon.map((c) => (
            <div key={c.name} className="m2-tile m2-soon" data-reveal>
              <Logo name={c.name} logo={c.logo} image={c.image} />
              <h3>{c.name}</h3>
              <p>{c.text}</p>
              <span className="m2-badge m2-soon-badge">Coming soon</span>
            </div>
          ))}
        </div>

        <h3 className="m2-sub">Already live</h3>
        <div className="m2-chips">
          {EXISTING_CONNECTORS.map((c) => (
            <span key={c.name} className="m2-chip">
              <Logo name={c.name} logo={c.logo} image={c.image} />
              {c.name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
