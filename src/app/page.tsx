import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { BASE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  openGraph: { url: `${BASE_URL}/` },
  alternates: { canonical: `${BASE_URL}/` },
};

const SOFTWARE_APPLICATION_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Mellox AI",
  url: `${BASE_URL}/`,
  applicationCategory: "BusinessApplication",
  description:
    "Mellox AI is the Marketing Intelligence Layer built on your Brand DNA — plan, create and optimize with AEO/GEO intelligence and Ravi, your AI marketing analyst.",
  offers: [
    { "@type": "Offer", name: "Starter", price: "9", priceCurrency: "USD" },
    { "@type": "Offer", name: "Growth", price: "29", priceCurrency: "USD" },
    { "@type": "Offer", name: "Agency OS", price: "79", priceCurrency: "USD" },
  ],
};

const FAQ_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What is the Marketing Intelligence Layer?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "The Marketing Intelligence Layer is Mellox AI's AI-native workspace where brands and agencies plan, create and optimize marketing grounded in their Brand DNA, with AEO/GEO intelligence so they get visible inside LLMs like ChatGPT, Perplexity and Gemini.",
      },
    },
    {
      "@type": "Question",
      name: "How does Mellox AI use Brand DNA?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Mellox AI builds every recommendation on your Brand DNA — your positioning, voice and audience — so the content, AEO and GEO optimizations it generates stay on-brand and consistent.",
      },
    },
    {
      "@type": "Question",
      name: "What is AEO/GEO and why does it matter?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "AEO (Answer Engine Optimization) and GEO (Generative Engine Optimization) help your content get cited and recommended by AI assistants. Mellox AI's Ravi analyst monitors your visibility and suggests optimizations for ChatGPT, Perplexity, Gemini and Claude.",
      },
    },
  ],
};

const proofPoints = ["Brand DNA grounding", "AI visibility tracking", "AEO + GEO optimization"];

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(SOFTWARE_APPLICATION_LD) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_LD) }}
      />

      <main className="min-h-screen bg-background text-foreground">
        <div className="mx-auto max-w-6xl px-5 sm:px-6 lg:px-8">
          <header className="flex items-center justify-between py-6">
            <Link href="/" aria-label="Mellox AI home" className="flex items-center">
              <Logo height={28} />
            </Link>

            <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
              <Link href="#platform" className="transition hover:text-foreground">
                Platform
              </Link>
              <Link href="#insights" className="transition hover:text-foreground">
                Insights
              </Link>
              <Link href="#pricing" className="transition hover:text-foreground">
                Pricing
              </Link>
            </nav>

            <div className="flex items-center gap-3">
              <Link
                href="/login"
                className="rounded-full border border-border/80 bg-background/60 px-4 py-2 text-sm font-medium text-foreground transition hover:border-foreground/30"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-[0_10px_30px_-12px_hsl(var(--primary))] transition hover:brightness-110"
              >
                Get started
              </Link>
            </div>
          </header>

          <section className="grid gap-12 pb-16 pt-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:pb-20 lg:pt-16">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/70 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground backdrop-blur">
                <span className="h-2 w-2 rounded-full bg-brand-green shadow-[0_0_12px_hsl(var(--brand-green))]" />
                Marketing intelligence layer
              </div>

              <h1 className="mt-6 max-w-xl font-display text-[clamp(3rem,5vw,5rem)] leading-[0.93] tracking-[-0.05em] text-foreground">
                Get visible inside the AI that decides what people buy.
              </h1>

              <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
                Mellox AI turns your brand DNA, content, and AEO/GEO signals into a single operating
                system for teams that want to win in ChatGPT, Gemini, Perplexity, and beyond.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/signup"
                  className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-[0_15px_35px_-12px_hsl(var(--primary))] transition hover:brightness-110"
                >
                  Get started
                </Link>
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center rounded-full border border-border/80 bg-background/80 px-5 py-3 text-sm font-semibold text-foreground transition hover:border-foreground/30"
                >
                  Book a demo
                </Link>
              </div>

              <ul className="mt-8 flex flex-wrap gap-4 text-sm text-muted-foreground">
                {proofPoints.map((point) => (
                  <li
                    key={point}
                    className="flex items-center gap-2 rounded-full border border-border/60 bg-card/70 px-3 py-1.5"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-brand-green" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative">
              <div className="absolute inset-0 -z-10 rounded-[2rem] bg-gradient-to-br from-brand-green/22 via-brand-blue/12 to-transparent blur-3xl" />
              <div className="rounded-[2rem] border border-border/80 bg-card/85 p-5 shadow-[0_25px_80px_-40px_hsl(var(--foreground)/0.25)] backdrop-blur-xl sm:p-6">
                <div className="flex items-center justify-between border-b border-border/70 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/12 text-primary ring-1 ring-primary/25">
                      <span className="text-lg font-semibold">M</span>
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-foreground">Mellox AI</div>
                      <div className="text-xs text-muted-foreground">workspace overview</div>
                    </div>
                  </div>
                  <span className="rounded-full border border-border/70 bg-background/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    live
                  </span>
                </div>

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl border border-border/70 bg-background/60 p-4">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                      brand dna
                    </div>
                    <div className="mt-4 text-3xl font-semibold text-foreground">96%</div>
                    <div className="mt-2 text-sm text-muted-foreground">positioning alignment</div>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/60 p-4">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                      visibility
                    </div>
                    <div className="mt-4 text-3xl font-semibold text-foreground">+124%</div>
                    <div className="mt-2 text-sm text-muted-foreground">
                      AI citations this quarter
                    </div>
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border border-border/70 bg-background/60 p-4">
                  <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                    <span>content engine</span>
                    <span>weekly</span>
                  </div>
                  <div className="mt-4 space-y-3">
                    {[
                      ["Brand-safe briefs", "12"],
                      ["AEO briefs", "18"],
                      ["Social drafts", "29"],
                    ].map(([label, value]) => (
                      <div key={label} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-semibold text-foreground">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section id="platform" className="grid gap-5 pb-24 md:grid-cols-3">
            {[
              {
                title: "Brand DNA",
                copy: "Turn positioning, audience, voice, and category intelligence into a durable strategic layer.",
              },
              {
                title: "AEO + GEO",
                copy: "Optimize every asset for answer engines, search, and AI copilots before the market catches up.",
              },
              {
                title: "AI marketing ops",
                copy: "Coordinate briefs, approvals, workflows, and distribution from one shared operating layer.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-[1.75rem] border border-border/70 bg-card/70 p-6 shadow-[0_18px_60px_-40px_hsl(var(--foreground)/0.22)] backdrop-blur"
              >
                <div className="mb-4 h-10 w-10 rounded-xl bg-primary/10 ring-1 ring-primary/20" />
                <h2 className="text-xl font-semibold text-foreground">{item.title}</h2>
                <p className="mt-3 text-sm leading-7 text-muted-foreground">{item.copy}</p>
              </div>
            ))}
          </section>
        </div>
      </main>
    </>
  );
}
