import Link from "next/link";
import Mox from "@/components/mox/Mox";
import { COMING_SOON, NETWORKS, PILLARS, type Pillar } from "@/lib/platform";
import PlatformReveal from "./PlatformReveal";
import "./platform.css";

function Badge({ p }: { p: Pillar }) {
  return p.badge ? <span className="pf-badge">{p.badge}</span> : null;
}

/** Home page: every area of Mellox as a card, with Mox beside each one. */
export function PlatformGrid() {
  return (
    <section id="platform" className="pf" aria-labelledby="pf-title">
      <PlatformReveal />
      <div className="pf-inner">
        <div className="pf-label" data-reveal>
          <Mox pose="visor" height={34} decorative className="pf-visor" />
          <span>EVERYTHING IN ONE PLATFORM</span>
        </div>
        <div className="pf-rule" data-reveal />
        <div className="pf-head">
          <h2 id="pf-title" data-reveal>
            One place for your whole marketing.
          </h2>
          <p data-reveal style={{ transitionDelay: "120ms" }}>
            Understand your brand, make the content, publish it, and see what worked. Ten connected areas, no stitched-together tabs.
          </p>
        </div>

        <div className="pf-grid">
          {PILLARS.map((p, i) => {
            const Icon = p.icon;
            return (
              <Link
                key={p.id}
                href={p.href}
                className={`pf-card pf-c-${p.id}`}
                style={{ ["--pc" as string]: p.color, transitionDelay: `${(i % 3) * 70}ms` }}
                data-reveal
              >
                <div className="pf-card-top">
                  <span className="pf-icon">
                    <Icon size={22} strokeWidth={1.7} aria-hidden="true" />
                  </span>
                  <Badge p={p} />
                </div>
                <h3>{p.title}</h3>
                <p className="pf-tag">{p.tagline}</p>
                <ul>
                  {p.features.slice(0, 3).map((f) => (
                    <li key={f.title}>{f.title}</li>
                  ))}
                  {p.features.length > 3 && <li className="pf-more">+{p.features.length - 3} more</li>}
                </ul>
                <span className="pf-link">
                  Explore <span aria-hidden="true">→</span>
                </span>
                <Mox pose={p.pose} height={118} decorative float className="pf-mox" />
              </Link>
            );
          })}
        </div>

        <div className="pf-nets" data-reveal>
          <p>Publishes to</p>
          <ul>
            {NETWORKS.map((n) => (
              <li key={n.name} title={n.name}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/llms/${n.logo}.svg`} alt={n.name} width={22} height={22} loading="lazy" />
              </li>
            ))}
          </ul>
          <span className="pf-soon">
            <COMING_SOON.icon size={15} aria-hidden="true" /> Coming soon: {COMING_SOON.title}
          </span>
        </div>
      </div>
    </section>
  );
}

/** /features: one full section per area, alternating sides, with a big Mox. */
export function PlatformSections() {
  return (
    <>
      <PlatformReveal />
      {PILLARS.map((p, i) => {
        const Icon = p.icon;
        return (
          <section key={p.id} id={p.id} className="pf-sec" style={{ ["--pc" as string]: p.color }}>
            <div className="pf-inner">
              <div className={`pf-row${i % 2 ? " pf-flip" : ""}`}>
                <div className="pf-row-copy" data-reveal>
                  <div className="pf-row-head">
                    <span className="pf-icon">
                      <Icon size={24} strokeWidth={1.7} aria-hidden="true" />
                    </span>
                    <span className="pf-num">{String(i + 1).padStart(2, "0")}</span>
                    <Badge p={p} />
                  </div>
                  <h2>{p.title}</h2>
                  <p className="pf-lede">{p.text}</p>
                  <dl className="pf-feats">
                    {p.features.map((f) => (
                      <div key={f.title}>
                        <dt>{f.title}</dt>
                        <dd>{f.text}</dd>
                      </div>
                    ))}
                  </dl>
                  {!p.href.startsWith("/features#") && (
                    <Link href={p.href} className="pf-deep">
                      Learn more about {p.title} <span aria-hidden="true">→</span>
                    </Link>
                  )}
                </div>
                <div className="pf-row-art" data-reveal style={{ transitionDelay: "120ms" }}>
                  <div className="pf-stage">
                    <p className="pf-quote">{p.tagline}</p>
                    <Mox pose={p.pose} height={300} float />
                  </div>
                </div>
              </div>
            </div>
          </section>
        );
      })}
      <section id="coming-soon" className="pf-sec pf-soon-sec">
        <div className="pf-inner">
          <div className="pf-soon-card" data-reveal>
            <span className="pf-icon">
              <COMING_SOON.icon size={24} strokeWidth={1.7} aria-hidden="true" />
            </span>
            <div>
              <h2>
                {COMING_SOON.title} <span className="pf-badge">Coming soon</span>
              </h2>
              <p>{COMING_SOON.text}</p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
