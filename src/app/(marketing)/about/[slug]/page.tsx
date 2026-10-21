import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { NETWORKS } from "@/marketing/components/about/Founders";
import Footer from "@/marketing/components/Footer";
import GlassFilter from "@/marketing/components/GlassFilter";
import JsonLd from "@/marketing/components/JsonLd";
import Navbar from "@/marketing/components/Navbar";
import { FOUNDERS, founderPath } from "@/marketing/lib/about";
import { founderId, founderPersonLd, founderUrl } from "@/marketing/lib/founder-ld";
import { SITE_NAME, SITE_URL, faqJsonLd } from "@/marketing/lib/seo";
import "@/marketing/components/pricing/pricing.css";
import "@/marketing/components/about/about.css";
import "@/marketing/components/about/founder-profile.css";

// /about/<slug>: one page per founder who has a profile. It exists so that a search for the person's name, in any of
// the forms people type, and an AI assistant asked "who is …?" both find one clear, first-party answer:
// the name in the title, the heading and the first sentence, every other form of the name stated in plain words,
// visible questions and answers, and structured data (ProfilePage + Person + FAQPage) that says the same things.

type Props = { params: Promise<{ slug: string }> };

const WITH_PROFILE = FOUNDERS.filter((f) => f.profile);
const bySlug = (slug: string) => WITH_PROFILE.find((f) => f.profile?.slug === slug);

export function generateStaticParams() {
  return WITH_PROFILE.map((f) => ({ slug: f.profile!.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const f = bySlug(slug);
  if (!f?.profile) return {};
  const p = f.profile;
  const title = `${f.name}: ${f.role} of ${SITE_NAME}`;
  const [firstName, ...rest] = f.name.split(" ");
  return {
    title: { absolute: title },
    description: p.summary,
    keywords: [f.name, ...p.alsoKnownAs, `${f.name} ${SITE_NAME}`, `${SITE_NAME} founder`, `${SITE_NAME} CEO`],
    authors: [{ name: f.name, url: founderUrl(f) }],
    alternates: { canonical: founderPath(p.slug) },
    openGraph: {
      type: "profile",
      url: founderUrl(f),
      siteName: SITE_NAME,
      title,
      description: p.summary,
      firstName,
      lastName: rest.at(-1),
      images: [{ url: f.photo, width: 800, height: 1000, alt: `${f.name}, ${f.role} of ${SITE_NAME}` }],
    },
    twitter: { card: "summary_large_image", title, description: p.summary, images: [f.photo] },
  };
}

export default async function FounderProfilePage({ params }: Props) {
  const { slug } = await params;
  const f = bySlug(slug);
  if (!f?.profile) notFound();
  const p = f.profile;
  const url = founderUrl(f);

  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "ProfilePage",
        "@id": `${url}#profile`,
        url,
        name: `${f.name}: ${f.role} of ${SITE_NAME}`,
        description: p.summary,
        isPartOf: { "@id": `${SITE_URL}/#website` },
        about: { "@id": founderId(f) },
        mainEntity: { "@id": founderId(f) },
      },
      founderPersonLd(f),
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: SITE_NAME, item: SITE_URL },
          { "@type": "ListItem", position: 2, name: "About", item: `${SITE_URL}/about` },
          { "@type": "ListItem", position: 3, name: f.name, item: url },
        ],
      },
    ],
  };

  return (
    <div className="px fp relative flex min-h-screen flex-col overflow-x-clip" style={{ "--accent": f.accent } as CSSProperties}>
      <JsonLd data={graph} />
      <JsonLd data={faqJsonLd(p.faqs)} />

      <header className="fp-hero relative px-5 pt-32 sm:pt-36">
        <GlassFilter />
        <Navbar />
        <div className="px-inner">
          <nav aria-label="Breadcrumb" className="fp-crumbs">
            <Link href="/">{SITE_NAME}</Link>
            <span aria-hidden="true">/</span>
            <Link href="/about">About</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{f.name}</span>
          </nav>

          <div className="fp-top">
            <div className="fp-photo">
              <Image
                src={f.photo}
                alt={`${f.name}, ${f.role} of ${SITE_NAME}`}
                width={800}
                height={1000}
                sizes="(max-width: 860px) 90vw, 420px"
                priority
              />
            </div>

            <div className="fp-intro">
              <p className="fp-role">
                {f.role}, {SITE_NAME}
              </p>
              <h1>{f.name}</h1>
              <p className="fp-aka">
                {p.fullName !== f.name && <>Full name {p.fullName}. </>}
                Also known as {p.alsoKnownAs.filter((n) => n !== p.fullName).join(" and ")}.
                {p.country && <> Based in {p.country}.</>}
              </p>
              <p className="fp-summary">{p.summary}</p>
              <ul className="ab-socials fp-socials" aria-label={`${f.name} on social media`}>
                {f.socials.map((s) => (
                  <li key={s.network}>
                    <a
                      href={s.href}
                      target="_blank"
                      rel="me noopener noreferrer"
                      aria-label={`${f.name} on ${NETWORKS[s.network].label} (opens in a new tab)`}
                      title={NETWORKS[s.network].label}
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d={NETWORKS[s.network].path} />
                      </svg>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </header>

      <main className="fp-main">
        <div className="px-inner">
          <section className="fp-block" aria-labelledby="fp-about">
            <h2 id="fp-about">About {f.name}</h2>
            <div className="fp-prose">
              {p.story.map((para) => (
                <p key={para.slice(0, 32)}>{para}</p>
              ))}
            </div>
          </section>

          <section className="fp-block" aria-labelledby="fp-vision">
            <h2 id="fp-vision">Building {SITE_NAME}</h2>
            <div className="fp-prose">
              {p.vision && <p>{p.vision}</p>}
              {p.quote && (
                <blockquote>
                  <p>{p.quote}</p>
                  <footer>{f.name}</footer>
                </blockquote>
              )}
              <p>
                {f.name} is {f.role} of {SITE_NAME}, alongside{" "}
                {FOUNDERS.filter((o) => o !== f).map((o) =>
                  o.profile ? (
                    <Link key={o.name} href={founderPath(o.profile.slug)}>
                      {o.name}
                    </Link>
                  ) : (
                    o.name
                  ),
                )}{" "}
                ({FOUNDERS.filter((o) => o !== f)
                  .map((o) => o.role)
                  .join(", ")}
                ).
              </p>
              <p>
                <Link href="/about">Read about {SITE_NAME}</Link> or <Link href="/">see what it does</Link>.
              </p>
            </div>
          </section>

          <section className="fp-block" aria-labelledby="fp-expertise">
            <h2 id="fp-expertise">Areas of expertise</h2>
            <ul className="fp-tags">
              {p.expertise.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </section>

          {f.recognition.length > 0 && (
            <section className="fp-block" aria-labelledby="fp-recognition">
              <h2 id="fp-recognition">Awards and recognition</h2>
              <ul className="fp-list">
                {f.recognition.map((r) => (
                  <li key={r.title}>
                    <strong>{r.title}</strong>
                    <span>{r.note}</span>
                    {r.href && (
                      <a href={r.href} target="_blank" rel="noopener noreferrer">
                        See the listing<span className="sr-only"> for {r.title} (opens in a new tab)</span>
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="fp-block" aria-labelledby="fp-links">
            <h2 id="fp-links">Official accounts</h2>
            <ul className="fp-list">
              {f.socials.map((s) => (
                <li key={s.network}>
                  <strong>{NETWORKS[s.network].label}</strong>
                  <a href={s.href} target="_blank" rel="me noopener noreferrer">
                    {s.href.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                  </a>
                </li>
              ))}
            </ul>
          </section>

          {/* Questions and answers are shown in full, not folded away: this is the text people and AI assistants look for. */}
          <section className="fp-block" aria-labelledby="fp-faq">
            <h2 id="fp-faq">Questions about {f.name}</h2>
            <dl className="fp-faq">
              {p.faqs.map((q) => (
                <div key={q.q}>
                  <dt>{q.q}</dt>
                  <dd>{q.a}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
