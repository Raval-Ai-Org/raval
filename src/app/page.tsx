import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { BASE_URL } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  BarChart,
  Brain,
  Calendar,
  Check,
  Globe,
  Layers,
  Sparkles,
  Target,
} from "@/components/icons";

export const metadata: Metadata = {
  openGraph: { url: `${BASE_URL}/` },
  alternates: { canonical: `${BASE_URL}/` },
};

/**
 * Pricing is declared once, here, and fed to both the rendered table and the
 * JSON-LD below it. The structured data used to advertise three tiers that had
 * no section on the page at all, which told search engines about prices a
 * visitor could never find.
 */
const PLANS = [
  {
    name: "Starter",
    price: 9,
    tagline: "For one brand finding its footing.",
    features: [
      "One workspace",
      "Brand DNA extraction",
      "AI visibility tracking",
      "Content calendar",
    ],
    cta: "Start free",
    highlighted: false,
  },
  {
    name: "Growth",
    price: 29,
    tagline: "For teams publishing every week.",
    features: [
      "Everything in Starter",
      "AEO + GEO optimisation",
      "Social publishing to every channel",
      "Competitor monitoring",
      "Approval workflows",
    ],
    cta: "Start free",
    highlighted: true,
  },
  {
    name: "Agency OS",
    price: 79,
    tagline: "For agencies running many brands.",
    features: [
      "Everything in Growth",
      "Unlimited client workspaces",
      "Client portals and share links",
      "Agency command centre",
      "White-labelled reporting",
    ],
    cta: "Talk to us",
    highlighted: false,
  },
] as const;

const PLATFORM = [
  {
    icon: Brain,
    title: "Brand DNA",
    copy: "Point Mellox at your site and it reads back your positioning, audience, and voice — then grounds every draft in it.",
  },
  {
    icon: Globe,
    title: "AEO + GEO",
    copy: "Track how ChatGPT, Gemini, Perplexity and Claude describe you, and see exactly which pages move the answer.",
  },
  {
    icon: Layers,
    title: "Marketing operations",
    copy: "Briefs, approvals, scheduling and publishing in one place, so the work leaves the workspace already on-brand.",
  },
] as const;

const WORKFLOW = [
  {
    icon: Sparkles,
    step: "Describe it",
    copy: "Ask in plain language. Mellox drafts against your Brand DNA, not a blank prompt.",
  },
  {
    icon: Target,
    step: "Shape it",
    copy: "Adjust tone, angle and channel in the Studio. Every variant stays inside your guardrails.",
  },
  {
    icon: Calendar,
    step: "Ship it",
    copy: "Approve once, then schedule to LinkedIn, X, Instagram and Facebook from the same view.",
  },
  {
    icon: BarChart,
    step: "See what landed",
    copy: "Organic and AI-citation performance side by side, per brand.",
  },
] as const;

const SOFTWARE_APPLICATION_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Mellox AI",
  url: `${BASE_URL}/`,
  applicationCategory: "BusinessApplication",
  description:
    "Mellox AI is the Marketing Intelligence Layer built on your Brand DNA — plan, create and optimize with AEO/GEO intelligence and Ravi, your AI marketing analyst.",
  offers: PLANS.map((plan) => ({
    "@type": "Offer",
    name: plan.name,
    price: String(plan.price),
    priceCurrency: "USD",
    url: `${BASE_URL}/#pricing`,
  })),
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

const NAV = [
  { href: "#platform", label: "Platform" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#pricing", label: "Pricing" },
];

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

      {/* A <div>, not a <main>: the root layout already provides the single
          <main id="main-content"> landmark that the skip link targets, and
          nesting a second one is a duplicate-landmark violation. */}
      <div className="bg-background text-foreground">
        <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-6 lg:px-8">
            <Link href="/" aria-label="Mellox AI home" className="flex items-center">
              <Logo height={26} />
            </Link>

            <nav aria-label="Sections" className="hidden items-center gap-7 text-sm md:flex">
              {NAV.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  {item.label}
                </a>
              ))}
            </nav>

            <div className="flex items-center gap-2">
              <Button asChild variant="ghost" size="sm">
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/signup">Get started</Link>
              </Button>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-6xl px-5 sm:px-6 lg:px-8">
          {/* ── Hero ─────────────────────────────────────────────────── */}
          <section className="grid gap-14 pb-20 pt-14 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:pt-20">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium uppercase tracking-caps text-muted-foreground">
                <span
                  aria-hidden
                  className="size-1.5 rounded-full bg-brand shadow-[0_0_10px_hsl(var(--brand)/0.9)]"
                />
                Marketing intelligence layer
              </p>

              <h1 className="mt-6 max-w-xl font-display text-[clamp(2.5rem,5vw,4.5rem)] font-semibold leading-[0.98] tracking-tighter text-foreground">
                Get visible inside the AI that decides what people buy.
              </h1>

              <p className="mt-6 max-w-xl text-md leading-relaxed text-muted-foreground">
                Mellox AI turns your brand DNA, content, and AEO/GEO signals into a single operating
                system for teams that want to win in ChatGPT, Gemini, Perplexity, and beyond.
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="xl">
                  <Link href="/signup">
                    Start free
                    <ArrowRight className="size-5" />
                  </Link>
                </Button>
                <Button asChild size="xl" variant="outline">
                  <a href="#how-it-works">See how it works</a>
                </Button>
              </div>

              <p className="mt-5 text-sm text-muted-foreground">
                No card required. Connect a site and see your Brand DNA in under a minute.
              </p>
            </div>

            <HeroDiagram />
          </section>

          {/* ── Platform ─────────────────────────────────────────────── */}
          <section id="platform" className="scroll-mt-24 border-t border-border/70 py-20">
            <SectionHeading
              eyebrow="Platform"
              title="Three layers, one workspace"
              copy="Strategy, visibility, and distribution stop living in separate tools."
            />

            <div className="mt-12 grid gap-5 md:grid-cols-3">
              {PLATFORM.map(({ icon: Icon, title, copy }) => (
                <div
                  key={title}
                  className="rounded-2xl border border-border bg-surface-3 p-6 shadow-1 transition-shadow hover:shadow-2"
                >
                  {/* Real icons. These cards used to render an empty tinted
                      square where the icon belonged. */}
                  <span
                    aria-hidden
                    className="grid size-11 place-items-center rounded-xl bg-primary-surface text-primary ring-1 ring-primary-border"
                  >
                    <Icon className="size-5" />
                  </span>
                  <h3 className="mt-5 text-lg font-semibold text-foreground">{title}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{copy}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ── How it works ─────────────────────────────────────────── */}
          <section id="how-it-works" className="scroll-mt-24 border-t border-border/70 py-20">
            <SectionHeading
              eyebrow="How it works"
              title="From a sentence to a scheduled post"
              copy="The same loop, whether you run one brand or forty."
            />

            <ol className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {WORKFLOW.map(({ icon: Icon, step, copy }, index) => (
                <li
                  key={step}
                  className="relative rounded-2xl border border-border bg-surface-3 p-5 shadow-1"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className="grid size-8 place-items-center rounded-lg bg-surface-2 text-primary ring-1 ring-border"
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-caps text-muted-foreground">
                      Step {index + 1}
                    </span>
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-foreground">{step}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{copy}</p>
                </li>
              ))}
            </ol>
          </section>

          {/* ── Pricing ──────────────────────────────────────────────── */}
          <section id="pricing" className="scroll-mt-24 border-t border-border/70 py-20">
            <SectionHeading
              eyebrow="Pricing"
              title="Priced per brand, not per seat"
              copy="Invite the whole team on any plan. Start free, upgrade when you publish."
            />

            <div className="mt-12 grid gap-5 lg:grid-cols-3">
              {PLANS.map((plan) => (
                <div
                  key={plan.name}
                  className={
                    plan.highlighted
                      ? "relative rounded-2xl border border-primary-border bg-surface-3 p-6 shadow-3 ring-1 ring-primary-border"
                      : "relative rounded-2xl border border-border bg-surface-3 p-6 shadow-1"
                  }
                >
                  {plan.highlighted ? (
                    <span className="absolute -top-3 left-6 rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">
                      Most popular
                    </span>
                  ) : null}

                  <h3 className="text-base font-semibold text-foreground">{plan.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>

                  <p className="mt-6 flex items-baseline gap-1.5">
                    <span className="font-display text-4xl font-semibold tabular-nums tracking-tight text-foreground">
                      ${plan.price}
                    </span>
                    <span className="text-sm text-muted-foreground">/ month</span>
                  </p>

                  <Button
                    asChild
                    className="mt-6 w-full"
                    variant={plan.highlighted ? "default" : "outline"}
                  >
                    <Link href={plan.name === "Agency OS" ? "/signup?plan=agency" : "/signup"}>
                      {plan.cta}
                    </Link>
                  </Button>

                  <ul className="mt-7 space-y-3 border-t border-border/70 pt-6">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2.5 text-sm">
                        <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
                        <span className="text-muted-foreground">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          {/* ── Closing CTA ──────────────────────────────────────────── */}
          <section className="border-t border-border/70 py-20">
            <div className="relative overflow-hidden rounded-3xl border border-border bg-surface-3 px-6 py-14 text-center shadow-2 sm:px-12">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    "radial-gradient(60% 70% at 50% 0%, hsl(var(--brand) / 0.14) 0%, transparent 70%)",
                }}
              />
              <div className="relative">
                <h2 className="font-display text-3xl font-semibold tracking-tight text-foreground">
                  See what the AI says about you today
                </h2>
                <p className="mx-auto mt-4 max-w-xl text-md text-muted-foreground">
                  Connect your site and Mellox will read your Brand DNA, audit your AI visibility,
                  and show you the first three things worth fixing.
                </p>
                <Button asChild size="xl" className="mt-8">
                  <Link href="/signup">
                    Start free
                    <ArrowRight className="size-5" />
                  </Link>
                </Button>
              </div>
            </div>
          </section>
        </div>

        <footer className="border-t border-border/70 py-12">
          <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <Logo height={22} />
              <nav
                aria-label="Footer"
                className="flex flex-wrap items-center gap-x-7 gap-y-3 text-sm"
              >
                {NAV.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {item.label}
                  </a>
                ))}
                <Link
                  href="/login"
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  Sign in
                </Link>
                <a
                  href="mailto:support@mellox.ai"
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  Support
                </a>
              </nav>
            </div>
            <p className="text-xs text-muted-foreground">
              © {new Date().getFullYear()} Mellox AI. The marketing intelligence layer.
            </p>
          </div>
        </footer>
      </div>
    </>
  );
}

function SectionHeading({
  eyebrow,
  title,
  copy,
}: {
  eyebrow: string;
  title: string;
  copy: string;
}) {
  return (
    <div className="max-w-2xl">
      <p className="text-xs font-semibold uppercase tracking-caps text-primary">{eyebrow}</p>
      <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      <p className="mt-3 text-md leading-relaxed text-muted-foreground">{copy}</p>
    </div>
  );
}

/**
 * The hero visual.
 *
 * What used to sit here was a mock workspace card showing "96% positioning
 * alignment", "+124% AI citations this quarter" and a weekly content count,
 * under a pulsing "live" badge — invented numbers presented as a real account.
 * This is an explicit diagram of what the product does instead: labelled as an
 * illustration, and it actually explains the pipeline.
 */
function HeroDiagram() {
  const channels = ["LinkedIn", "X", "Instagram", "Facebook"];

  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-6 -z-10 rounded-[3rem]"
        style={{
          background:
            "radial-gradient(60% 60% at 30% 20%, hsl(var(--brand) / 0.18) 0%, transparent 70%), radial-gradient(50% 50% at 80% 80%, hsl(var(--primary) / 0.18) 0%, transparent 70%)",
        }}
      />

      <figure className="rounded-3xl border border-border bg-surface-3 p-5 shadow-3 sm:p-6">
        <figcaption className="flex items-center justify-between gap-3 border-b border-border/70 pb-4">
          <span className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="grid size-8 place-items-center rounded-lg bg-primary-surface text-primary ring-1 ring-primary-border"
            >
              <Sparkles className="size-4" />
            </span>
            <span className="text-sm font-semibold text-foreground">How Mellox works</span>
          </span>
          <span className="shrink-0 whitespace-nowrap rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs uppercase tracking-caps text-muted-foreground">
            Example
          </span>
        </figcaption>

        <ol className="mt-5 space-y-3">
          <DiagramRow
            icon={Brain}
            label="Your Brand DNA"
            detail="Positioning, audience, voice, guardrails"
          />
          <Connector />
          <DiagramRow
            icon={Sparkles}
            label="Grounded drafts"
            detail="Posts, briefs and pages written inside your rules"
          />
          <Connector />
          <DiagramRow
            icon={Globe}
            label="AEO + GEO checks"
            detail="Scored for how answer engines will read it"
          />
        </ol>

        <div className="mt-5 rounded-2xl border border-border bg-surface-2 p-4">
          <p className="text-xs font-semibold uppercase tracking-caps text-muted-foreground">
            Published to
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {channels.map((channel) => (
              <span
                key={channel}
                className="rounded-full border border-border bg-surface-3 px-3 py-1.5 text-xs font-medium text-foreground"
              >
                {channel}
              </span>
            ))}
          </div>
        </div>
      </figure>
    </div>
  );
}

function DiagramRow({
  icon: Icon,
  label,
  detail,
}: {
  icon: typeof Brain;
  label: string;
  detail: string;
}) {
  return (
    <li className="flex items-start gap-3 rounded-2xl border border-border bg-surface-2 p-4">
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-3 text-primary ring-1 ring-border"
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-foreground">{label}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{detail}</span>
      </span>
    </li>
  );
}

function Connector() {
  return (
    <li aria-hidden className="flex justify-center py-0.5">
      <span className="h-4 w-px bg-border-strong" />
    </li>
  );
}
