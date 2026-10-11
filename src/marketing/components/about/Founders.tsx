import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import { FOUNDERS, founderPath, type FounderNetwork } from "@/marketing/lib/about";

/** Brand marks, single colour (they take the text colour). */
export const NETWORKS: Record<FounderNetwork, { label: string; path: string }> = {
  linkedin: {
    label: "LinkedIn",
    path: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.063 2.063 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z",
  },
  x: {
    label: "X",
    path: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z",
  },
  instagram: {
    label: "Instagram",
    path: "M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z",
  },
  facebook: {
    label: "Facebook",
    path: "M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.412c0-3.017 1.792-4.682 4.533-4.682 1.312 0 2.686.235 2.686.235v2.965h-1.514c-1.491 0-1.956.93-1.956 1.884v2.262h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073",
  },
  youtube: {
    label: "YouTube",
    path: "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z",
  },
  tiktok: {
    label: "TikTok",
    path: "M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.55a8.16 8.16 0 0 0 4.77 1.52V6.69h-1.84z",
  },
  github: {
    label: "GitHub",
    path: "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
  },
};

/** A stagger step for the entrance, read by the CSS as `--i`. */
const step = (i: number) => ({ "--i": i }) as CSSProperties;

/**
 * The founders, as editorial rows: a black-and-white portrait on a flat block of the founder's colour, the name set
 * very large, a short line about them, their own accounts, and what they have been recognised for.
 * Everything arrives in sequence when the row scrolls into view (`.is-in`, added by PricingReveal).
 */
export default function Founders() {
  return (
    <div className="ab-founders">
      {FOUNDERS.map((f, i) => {
        const words = f.name.split(" ");
        return (
          <article
            key={f.name}
            className="ab-founder"
            data-reveal
            style={{ "--accent": f.accent } as CSSProperties}
          >
            <div className="ab-photo">
              <div className="ab-photo-frame">
                <Image
                  src={f.photo}
                  alt={`${f.name}, ${f.role} of Mellox`}
                  width={800}
                  height={1000}
                  sizes="(max-width: 860px) 90vw, 440px"
                />
              </div>
            </div>

            <div className="ab-photo-cap">
              <span className="ab-index" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 aria-label={f.name}>
                {words.map((word, w) => (
                  <span key={word} className="ab-word" aria-hidden="true">
                    <span style={step(w)}>{word}</span>
                  </span>
                ))}
              </h3>
              <p className="ab-role" style={step(words.length)}>
                {f.role}
              </p>
              <p className="ab-bio" style={step(words.length + 1)}>
                {f.bio}
                {f.profile && (
                  <>
                    {" "}
                    <Link className="ab-more" href={founderPath(f.profile.slug)}>
                      More about {f.name}
                    </Link>
                  </>
                )}
              </p>
              <ul className="ab-socials" aria-label={`${f.name} on social media`}>
                {f.socials.map((s, n) => (
                  <li key={s.network} style={step(words.length + 2 + n)}>
                    <a
                      href={s.href}
                      target="_blank"
                      rel="noopener noreferrer"
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

            {f.recognition.length > 0 && (
              <div className="ab-recog">
                <p className="ab-recog-label">Recognition</p>
                <ul>
                  {f.recognition.map((r, n) => (
                    <li key={r.title} style={step(n)}>
                      <span className="ab-recog-n" aria-hidden="true">
                        {String(n + 1).padStart(2, "0")}
                      </span>
                      <strong>{r.title}</strong>
                      <span className="ab-recog-note">{r.note}</span>
                      {r.href && (
                        // the whole cell opens the proof
                        <a
                          className="ab-recog-link"
                          href={r.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`${r.title}, ${r.note}: see the listing (opens in a new tab)`}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M7 17 17 7" />
                            <path d="M8 7h9v9" />
                          </svg>
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
