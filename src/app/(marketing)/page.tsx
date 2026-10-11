import type { Metadata } from "next";
import HeroBackground from "@/marketing/components/HeroBackground";
import GlassFilter from "@/marketing/components/GlassFilter";
import Clients from "@/marketing/components/Clients";
import HeroChat from "@/marketing/components/HeroChat";
import HeroHeadline from "@/marketing/components/HeroHeadline";
import HeroWall from "@/marketing/components/HeroWall";import IntroSection from "@/marketing/components/IntroSection";
import Brains from "@/marketing/components/Brains";
import Problems from "@/marketing/components/Problems";
import Footer from "@/marketing/components/Footer";
import Faq from "@/marketing/components/Faq";
import CustomerMap from "@/marketing/components/CustomerMap";
import Workflow from "@/marketing/components/Workflow";
import JsonLd from "@/marketing/components/JsonLd";
import Navbar from "@/marketing/components/Navbar";
import { FEATURED, faqs } from "@/marketing/lib/faqs";
import { SITE_DESCRIPTION, SITE_URL, faqJsonLd } from "@/marketing/lib/seo";
import PricingReveal from "@/marketing/components/pricing/PricingReveal";
import WhatsNew from "@/marketing/components/whats-new/WhatsNew";
import "@/marketing/components/pricing/pricing.css";

export const metadata: Metadata = {
  title: { absolute: "Mellox AI: AI Marketing Assistant & AI CMO for Brands" },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Mellox AI",
    url: SITE_URL,
    title: "Mellox AI: AI Marketing Assistant & AI CMO for Brands",
    description: SITE_DESCRIPTION,
    images: ["/marketing/opengraph-image.png"],
  },
};

export default function Home() {
  return (
    <div className="relative flex min-h-screen flex-1 flex-col overflow-x-clip bg-[#030405] text-white">
      <JsonLd data={faqJsonLd(faqs.slice(0, FEATURED))} />
      <main className="marketing-home-main flex flex-1 flex-col">
        {/* Hero: aurora + copy + chat. Its bottom edge is where the dashboard peeks in. */}
        <section className="relative flex flex-col items-center px-5 pb-[calc(var(--hero-dash-h)+0.5rem)] pt-36 sm:pt-40">
          <HeroBackground />
          <GlassFilter />
          <Navbar />

          {/* Four things, nothing else. Each arrives in turn (`hero-in`, ordered by --d) once the intro has cleared. */}
          <div className="hero-copy relative z-10 flex flex-col items-center">
            <p
              className="hero-pill hero-in rounded-full px-4 py-2 text-[11px] font-medium tracking-[0.02em] text-white/85 sm:text-[12.5px]"
              style={{ "--d": 0 } as React.CSSProperties}
            >
              The only AI you need for growth and marketing.
            </p>

            <div className="hero-in" style={{ "--d": 1 } as React.CSSProperties}>
              <HeroHeadline />
            </div>

            <div className="hero-in mt-10 flex w-full justify-center" style={{ "--d": 2 } as React.CSSProperties}>
              <HeroChat />
            </div>

            <p
              className="hero-in mt-5 text-center text-[14px] text-white/55 sm:text-[15px]"
              style={{ "--d": 3 } as React.CSSProperties}
            >
              No credit card required.{" "}
              <a
                href="/signup"
                className="font-medium text-white/85 underline decoration-white/25 underline-offset-4 transition-colors hover:text-lime hover:decoration-lime/60"
              >
                Sign up for free
              </a>
            </p>
          </div>
        </section>

        {/* The arc: what Mellox gets a brand. It overlaps the hero by a little more than --hero-dash-h, so it sits
            close under the copy, and turns, opens and lifts as you scroll. */}
        <div
          className="hero-in hero-in-rise relative z-20 -mt-[calc(var(--hero-dash-h)+clamp(1rem,2vw,2rem))]"
          style={{ "--d": 4 } as React.CSSProperties}
        >
          <HeroWall />
        </div>

        <Clients />

        <IntroSection />

        <Problems />

        <Brains />

        <Workflow />

        {/* New capabilities: reuses the pricing page design tokens through the .px wrapper */}
        <div className="px">
          <PricingReveal />
          <WhatsNew
            title="Now with Autopilot and your favourite tools."
            blurb="Autopilot mode, Claude and ChatGPT over MCP, Slack and Notion, and Canva editing."
          />
        </div>

        <CustomerMap />

        <Faq
          items={faqs.slice(0, FEATURED)}
          title="Curious about Mellox?"
          blurb="Answers to common questions about our AI marketing platform."
          showAllLink
        />
      </main>

      <Footer />
    </div>
  );
}
