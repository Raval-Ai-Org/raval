"use client";

import Link from "next/link";
import { useEffect } from "react";

import logoAsset from "@/assets/mellox-logo.svg.asset.json";

export default function NotFound() {
  // Inject noindex + a safe canonical at runtime so unmatched URLs never
  // become indexable and never claim to be another page.
  useEffect(() => {
    let cancelled = false;
    const apply = () => {
      if (cancelled) return;
      const ensure = (selector: string, create: () => HTMLElement) => {
        let el = document.head.querySelector(selector) as HTMLElement | null;
        if (!el) {
          el = create();
          document.head.appendChild(el);
        }
        return el;
      };
      const robots = ensure('meta[name="robots"][data-nf="1"]', () => {
        const m = document.createElement("meta");
        m.setAttribute("name", "robots");
        m.setAttribute("data-nf", "1");
        return m;
      });
      robots.setAttribute("content", "noindex,nofollow");
      // Remove any pre-existing canonical so we don't self-attribute this 404
      // to another route's URL.
      document.head.querySelectorAll('link[rel="canonical"]').forEach((n) => n.remove());
      document.title = "Page not found · Mellox AI";
    };
    apply();
    const t1 = setTimeout(apply, 100);
    const t2 = setTimeout(apply, 500);
    return () => {
      cancelled = true;
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <img
          src={logoAsset.url}
          alt="Mellox AI"
          className="mx-auto h-[88px] w-[88px] rounded-[26%] ring-1 ring-border/60 shadow-[0_4px_14px_-6px_rgba(0,0,0,0.18)]"
          draggable={false}
        />
        <h1 className="mt-6 text-7xl font-bold gradient-text">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This route isn&apos;t part of the Mellox AI workspace.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
