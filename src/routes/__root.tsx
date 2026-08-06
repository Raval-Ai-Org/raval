import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  useLocation,
} from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";

import appCss from "../styles.css?url";

import logoAsset from "@/assets/raval-mark.png.asset.json";
import faviconAsset from "@/assets/favicon.svg.asset.json";

function NotFoundComponent() {
  // Inject noindex + a safe canonical at runtime so unmatched URLs never
  // become indexable and never claim to be another page. Runs in an effect
  // (after the router's head sync on hydration) so the 404 title sticks
  // instead of racing back to the shell title.
  useEffect(() => {
    let cancelled = false;
    // Apply the runtime 404 head immediately and re-assert it a few times so
    // the router's hydration head-sync (which can land after this effect)
    // can't clobber the title back to the shell title. Deterministic end
    // state: robots=noindex, no canonical, 404 title.
    const apply = () => {
      if (cancelled) return;
      const ensure = (selector: string, create: () => HTMLElement) => {
        let el = document.head.querySelector(selector) as HTMLElement | null;
        if (!el) { el = create(); document.head.appendChild(el); }
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
      document.title = "Page not found · Raval AI";
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
          alt="Raval Ai"
          className="mx-auto h-16 w-16 rounded-[26%] ring-1 ring-border/60 shadow-[0_4px_14px_-6px_rgba(0,0,0,0.18)]"
          draggable={false}
        />
        <h1 className="mt-6 text-7xl font-bold gradient-text">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This route isn't part of the Raval AI workspace.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}


function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const raw = error?.message ?? "";
  const display = /unauthorized|forbidden|invalid token|no authorization/i.test(raw)
    ? "You don't have permission to view this page. Please sign in and try again."
    : "An unexpected error occurred. Please try again.";
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">{display}</p>
        <button
          onClick={() => { router.invalidate(); reset(); }}
          className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#0f1411", media: "(prefers-color-scheme: dark)" },
      { name: "theme-color", content: "#f7f8fa", media: "(prefers-color-scheme: light)" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { title: "Raval AI — The Marketing Intelligence Layer" },
      { name: "description", content: "Raval AI is the AI-native platform that helps brands and agencies plan, create, optimize and grow their marketing from one workspace — powered by Brand DNA, AEO/GEO intelligence and multi-client operations to get you visible inside LLMs." },
      { property: "og:title", content: "Raval AI — The Marketing Intelligence Layer" },
      { property: "og:description", content: "Get visible inside LLMs. Raval AI is the AI-native marketing platform for brands and agencies — plan, create, optimize and grow from one workspace grounded in your Brand DNA." },
      { property: "og:site_name", content: "Raval AI" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Raval AI — The Marketing Intelligence Layer" },
      { name: "twitter:description", content: "Get visible inside LLMs. Raval AI is the AI-native marketing platform for brands and agencies — plan, create, optimize and grow from one workspace grounded in your Brand DNA." },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/XZzWHMlbweRejWDVyKWThlteKfK2/social-images/social-1780771486300-Untitled_design_(12).webp" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/XZzWHMlbweRejWDVyKWThlteKfK2/social-images/social-1780771486300-Untitled_design_(12).webp" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: faviconAsset.url },
      { rel: "apple-touch-icon", href: faviconAsset.url },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter+Tight:wght@400;500;600;700;800&display=swap" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,300..600,0..1,-25..0&display=swap" },
      { rel: "stylesheet", href: appCss },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "@id": "https://raval6.lovable.app/#organization",
              name: "Raval AI",
              url: "https://raval6.lovable.app",
              logo: {
                "@type": "ImageObject",
                url: "https://raval6.lovable.app/favicon.svg",
              },
              description:
                "Raval AI is the Marketing Intelligence Layer — an AI-native platform that helps brands and agencies get visible inside LLMs.",
              sameAs: [],
            },
            {
              "@type": "WebSite",
              "@id": "https://raval6.lovable.app/#website",
              url: "https://raval6.lovable.app",
              name: "Raval AI",
              description:
                "Get visible inside LLMs. The AI-native marketing platform for brands and agencies.",
              publisher: { "@id": "https://raval6.lovable.app/#organization" },
              inLanguage: "en",
            },
          ],
        }),
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

// Runs before paint to apply persisted theme/density/reduced-motion preferences
// so the chat surface never flashes the wrong theme on reload.
const PRE_HYDRATE = `(function(){try{
  var d=document.documentElement,ls=window.localStorage;
  var t=ls.getItem('reach-theme');
  if(!t){ t='dark'; }
  d.classList.toggle('dark', t==='dark');
  var den=ls.getItem('chat-density'); d.dataset.chatDensity=(den==='compact'||den==='comfortable')?den:'comfortable';
  var rm=ls.getItem('chat-reduced-motion');
  if(rm==='1'||rm==='0'){ d.dataset.chatMotion=rm==='1'?'reduced':'full'; }
  else { d.dataset.chatMotion=(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)?'reduced':'full'; }
}catch(e){}})();`;

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: PRE_HYDRATE }} />
      </head>
      <body suppressHydrationWarning>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-foreground focus:px-3 focus:py-2 focus:text-background focus:shadow-lg focus-visible:outline-none"
        >
          Skip to main content
        </a>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RouteProgress() {
  const isLoading = useRouterState({ select: (s) => s.isLoading || s.isTransitioning });
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let raf = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (isLoading) {
      setVisible(true);
      setProgress(8);
      const tick = () => {
        setProgress((p) => (p < 85 ? p + (85 - p) * 0.08 : p));
        raf = window.requestAnimationFrame(tick);
      };
      raf = window.requestAnimationFrame(tick);
    } else if (visible) {
      setProgress(100);
      timeout = setTimeout(() => { setVisible(false); setProgress(0); }, 260);
    }
    return () => { if (raf) cancelAnimationFrame(raf); if (timeout) clearTimeout(timeout); };
  }, [isLoading, visible]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[200] h-[2px]"
      style={{ opacity: visible ? 1 : 0, transition: "opacity 240ms ease" }}
    >
      <div
        className="h-full origin-left bg-gradient-to-r from-[hsl(var(--brand-green))] via-[hsl(var(--brand-blue))] to-[hsl(var(--brand-green))]"
        style={{
          width: `${progress}%`,
          transition: "width 220ms cubic-bezier(0.22, 1, 0.36, 1)",
          boxShadow: "0 0 12px color-mix(in oklab, hsl(var(--brand-green)) 60%, transparent)",
        }}
      />
    </div>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const location = useLocation();
  const reduce = useReducedMotion();

  // Group transitions by top-level segment so nested tabs (e.g. /app → /app/analytics)
  // don't fully unmount the shell — only the leaf content re-animates.
  const segment = "/" + (location.pathname.split("/")[1] ?? "");

  return (
    <QueryClientProvider client={queryClient}>
      <RouteProgress />
      <main id="main-content">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={segment}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6, filter: "blur(4px)" }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4, filter: "blur(4px)" }}
            transition={{ duration: reduce ? 0.15 : 0.32, ease: [0.22, 1, 0.36, 1] }}
            style={{ willChange: "opacity, transform, filter" }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
      <Toaster />
    </QueryClientProvider>
  );
}
