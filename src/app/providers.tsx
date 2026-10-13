"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const AppProviders = dynamic(() => import("./AppProviders"));
const PUBLIC_PAGES = new Set([
  "/",
  "/pricing",
  "/demo",
  "/compare",
  "/faq",
  "/about",
  "/security",
  "/changelog",
  "/contact",
  "/privacy",
  "/safety",
  "/terms",
  "/cookies",
  "/integrations",
]);
const PUBLIC_PREFIXES = [
  "/features/",
  "/use-cases/",
  "/blog",
  "/docs",
  "/about/",
  "/contact/",
  "/compare/",
];

function RouteProgress() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const [pending, setPending] = useState(false);

  // The App Router swaps the tree once the next segment is ready, so by the
  // time the pathname changes the navigation is already done. Showing the bar
  // then is honest only about "something happened" — keep it very short so a
  // hot navigation reads as instant rather than as half a second of loading.
  useEffect(() => {
    setPending(true);
    const done = setTimeout(() => setPending(false), 90);
    return () => clearTimeout(done);
  }, [pathname]);

  useEffect(() => {
    let raf = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (pending) {
      setVisible(true);
      setProgress(8);
      const tick = () => {
        setProgress((p) => (p < 85 ? p + (85 - p) * 0.08 : p));
        raf = window.requestAnimationFrame(tick);
      };
      raf = window.requestAnimationFrame(tick);
    } else if (visible) {
      setProgress(100);
      timeout = setTimeout(() => {
        setVisible(false);
        setProgress(0);
      }, 160);
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (timeout) clearTimeout(timeout);
    };
  }, [pending, visible]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[200] h-[2px]"
      style={{
        opacity: visible ? 1 : 0,
        transition: `opacity var(--motion-duration-medium) var(--motion-ease-standard)`,
      }}
    >
      <div
        className="h-full origin-left bg-brand"
        style={{
          width: `${progress}%`,
          transition: `width var(--motion-duration-base) var(--motion-ease-emphasized)`,
        }}
      />
    </div>
  );
}

/** Public pages do not need workspace auth, query caching or toast code. */
export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const publicPage =
    PUBLIC_PAGES.has(pathname) ||
    PUBLIC_PREFIXES.some(
      (p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : p + "/"),
    );
  return (
    <>
      <RouteProgress />
      {publicPage ? (
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
      ) : (
        <AppProviders>{children}</AppProviders>
      )}
    </>
  );
}
