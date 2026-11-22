import type { Metadata } from "next";
import Link from "next/link";
import CtaBand from "@/components/cta/CtaBand";
import Footer from "@/components/Footer";
import GlassFilter from "@/components/GlassFilter";
import { Mellox2Sections } from "@/components/mellox2/Mellox2";
import Navbar from "@/components/Navbar";
import PricingHeroBackground from "@/components/pricing/PricingHeroBackground";
import PricingReveal from "@/components/pricing/PricingReveal";
import { MELLOX2 } from "@/lib/mellox2";
import "@/components/pricing/pricing.css";
import "@/components/features/features.css";
import "@/components/integrations/integrations.css";
import "@/components/mellox2/mellox2.css";

export const metadata: Metadata = {
  title: "Mellox 2.0 and Mox: what's new",
  description:
    "Meet Mox, the new look, Campaigns, Inspo, the Reddit agent, new video types, creator UGC ads, product hero posters, Library taste and social analytics.",
  alternates: { canonical: "/features/mellox-2" },
};

export default function FeaturesPage() {
  return (
    <div className="px ft relative flex min-h-screen flex-col overflow-x-clip">
      <PricingReveal />

      <header className="px-hero relative flex flex-col items-center px-5 pb-12 pt-36 sm:pt-40">
        <PricingHeroBackground />
        <GlassFilter />
        <Navbar />

        <div className="relative z-10 flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/mox/visor.webp" alt="Mox, the Mellox 3D character, wearing a visor" width={280} height={208} className="mb-4 w-[220px] rounded-[32px] shadow-[0_20px_60px_-20px_rgba(35,253,54,0.55)] sm:w-[280px]" />
          <p className="m2 m2-pill mb-3">
            Mellox 2.0
          </p>
          <h1 className="ft-h1">Meet Mox. Meet the new Mellox.</h1>
          <p className="lede">
            A redesigned app with a 3D guide, Campaigns, Inspo, new video types, creator ads, posters, a smarter Library and social analytics.
          </p>
          <div className="ft-actions">
            <a href="https://app.mellox.ai" className="px-cta px-cta-lime">
              Start free
            </a>
            <Link href="/integrations#new-connectors" className="ft-ghost">
              New connectors
            </Link>
          </div>
          <nav className="ig-jump" aria-label="Jump to a feature">
            {MELLOX2.map((s) => (
              <a key={s.id} href={`#${s.id}`}>
                {s.title}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main>
        <Mellox2Sections />

        <CtaBand
          title="Try Mellox 2.0 on your own brand."
          text="Start free. No credit card required."
          primary={{ label: "Get started", href: "https://app.mellox.ai" }}
        />
      </main>

      <Footer />
    </div>
  );
}
