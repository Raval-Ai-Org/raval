import type { Metadata } from "next";
import HeroBackground from "@/marketing/components/HeroBackground";
import GlassFilter from "@/marketing/components/GlassFilter";
import Clients from "@/marketing/components/Clients";
import HeroChat from "@/marketing/components/HeroChat";
import HeroHeadline from "@/marketing/components/HeroHeadline";
import HeroDash from "@/marketing/components/HeroDash";
import IntroSection from "@/marketing/components/IntroSection";
import Brains from "@/marketing/components/Brains";
import Problems from "@/marketing/components/Problems";
import Footer from "@/marketing/components/Footer";
import Faq from "@/marketing/components/Faq";
import Testimonials from "@/marketing/components/Testimonials";
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
        <section className="relative flex flex-col items-center px-5 pb-[calc(var(--hero-dash-h)+3.5rem)] pt-36 sm:pt-40">
          <HeroBackground />
          <GlassFilter />
          <Navbar />

          <div className="relative z-10 flex flex-col items-center">
            <p className="hero-pill rounded-full px-4 py-2 text-[11px] font-medium tracking-[0.02em] text-white/85 sm:text-[12.5px]">
              The only AI you need for growth and marketing.
            </p>

            <HeroHeadline />

            <div className="mt-9 flex w-full justify-center">
              <HeroChat />
            </div>

            <p className="mt-5 text-center text-[14px] text-white/55 sm:text-[15px]">
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

        {/* Product shot: overlaps the hero by --hero-dash-h, then tilts flat and fills in as you scroll */}
        <div className="relative z-20 -mt-[var(--hero-dash-h)] flex justify-center px-5">
          <HeroDash />
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

        <Testimonials />

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
