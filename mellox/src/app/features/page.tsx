import type { Metadata } from "next";
import Link from "next/link";
import CtaBand from "@/components/cta/CtaBand";
import Footer from "@/components/Footer";
import GlassFilter from "@/components/GlassFilter";
import MoxJourney from "@/components/journey/MoxJourney";
import Mox from "@/components/mox/Mox";
import Navbar from "@/components/Navbar";
import { PlatformSections } from "@/components/platform/Platform";
import PricingHeroBackground from "@/components/pricing/PricingHeroBackground";
import PricingReveal from "@/components/pricing/PricingReveal";
import { PILLARS } from "@/lib/platform";
import "@/components/pricing/pricing.css";
import "@/components/features/features.css";
import "@/components/integrations/integrations.css";
import "@/components/mellox2/mellox2.css";

export const metadata: Metadata = {
  title: "Features: everything Mellox does for your marketing",
  description:
    "Brand Brain, Studio, Autopilot, Campaigns, chat assistant, AI Visibility, Experiments, analytics, publishing to eight networks, and team and client sharing. Everything Mellox does, explained.",
  alternates: { canonical: "/features" },
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
          <Mox pose="wave" height={230} float />
          <p className="m2 m2-pill mb-3 mt-4">Features</p>
          <h1 className="ft-h1">Everything Mellox does for your marketing.</h1>
          <p className="lede">
            Understand your brand, make the content, publish it, and see what worked. Follow Mox through the whole flow, then explore each area.
          </p>
          <div className="ft-actions">
            <a href="https://app.mellox.ai" className="px-cta px-cta-lime">
              Start free
            </a>
            <Link href="/features/mellox-2" className="ft-ghost">
              What&apos;s new in 2.0
            </Link>
          </div>
          <nav className="ig-jump" aria-label="Jump to a feature area">
            <a href="#journey">The flow</a>
            {PILLARS.map((p) => (
              <a key={p.id} href={`#${p.id}`}>
                {p.title}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main>
        <MoxJourney title="Follow Mox from website to results." blurb="Seven steps, one connected product. Scroll to see how each one works." />
        <PlatformSections />

        <CtaBand
          title="Try Mellox on your own brand."
          text="Start free. No credit card required."
          primary={{ label: "Get started", href: "https://app.mellox.ai" }}
        />
      </main>

      <Footer />
    </div>
  );
}
