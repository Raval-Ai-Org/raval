import { Check, FlaskConical } from "lucide-react";
import { TRY_FIRST } from "@/marketing/lib/pricing";
import SectionHead from "./SectionHead";

const APP_URL = "/signup";

export default function PricingTry() {
  return (
    <section id="trial" className="px-section">
      <div className="px-inner">
        <SectionHead
          icon={<FlaskConical size={32} strokeWidth={1.4} aria-hidden="true" />}
          label="Try it first"
          title="Try Growth for 7 days."
          blurb="Run a real week of marketing on your own brand, or talk to us about a larger team."
          wide
        />
        <div className="px-try">
          {TRY_FIRST.map((t, i) => (
            <article key={t.id} className="px-card" data-reveal style={{ transitionDelay: `${i * 90}ms` }}>
              <span className="px-kicker">{t.kicker}</span>
              <h3>{t.name}</h3>
              <p className="blurb">{t.blurb}</p>
              <ul className="px-feats">
                {t.features.map((f) => (
                  <li key={f}>
                    <span className="px-tick">
                      <Check strokeWidth={2.4} aria-hidden="true" />
                    </span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <a
                href={t.id === "enterprise" ? "/demo?interest=scale" : APP_URL}
                className={`px-cta ${t.id === "trial" ? "px-cta-lime" : "hero-cta"}`}
              >
                {t.cta}
              </a>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
