import type { Metadata, Viewport } from "next";
import { Google_Sans_Flex, Michroma } from "next/font/google";
import { BASE_URL } from "@/lib/seo";
import { siteGraph, serializeJsonLd } from "@/marketing/lib/seo";
import { Providers } from "@/app/providers";

import "@/styles.css";

import faviconAsset from "@/assets/Favicon-updated.png";

const faviconUrl = faviconAsset.src;
const googleSansFlex = Google_Sans_Flex({
  variable: "--font-google-sans-flex",
  subsets: ["latin"],
  display: "swap",
  adjustFontFallback: false,
});
const michroma = Michroma({
  variable: "--font-michroma",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: "Mellox AI | Marketing Intelligence Layer",
  description:
    "Get visible inside LLMs. Mellox AI is the AI-native marketing platform for brands and agencies — plan, create, optimize and grow from one workspace grounded in your Brand DNA.",
  applicationName: "Mellox AI",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [{ url: faviconUrl, type: "image/png", sizes: "any" }],
    shortcut: [{ url: faviconUrl, type: "image/png" }],
    apple: [{ url: faviconUrl, type: "image/png" }],
  },
  openGraph: {
    title: "Mellox AI | Marketing Intelligence Layer",
    description:
      "Get visible inside LLMs. Mellox AI is the AI-native marketing platform for brands and agencies — plan, create, optimize and grow from one workspace grounded in your Brand DNA.",
    siteName: "Mellox AI",
    type: "website",
    images: [{ url: `${BASE_URL}${faviconUrl}`, type: "image/png" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Mellox AI | Marketing Intelligence Layer",
    description:
      "Get visible inside LLMs. Mellox AI is the AI-native marketing platform for brands and agencies — plan, create, optimize and grow from one workspace grounded in your Brand DNA.",
    images: [{ url: `${BASE_URL}${faviconUrl}`, type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Must match --background in src/styles.css, or the browser chrome on mobile
  // renders a different colour than the page it frames.
  themeColor: [
    { color: "#000000", media: "(prefers-color-scheme: dark)" },
    { color: "#f3f4f7", media: "(prefers-color-scheme: light)" },
  ],
};

// Runs before paint so the page never flashes the wrong theme on reload.
// The storage key must stay in sync with THEME_STORAGE_KEY in
// src/hooks/use-theme.tsx; 'reach-theme' is the superseded key, read once so
// existing users keep the theme they picked.
//
// An absent preference means "system", which is why prefers-color-scheme is
// consulted here rather than defaulting everyone to dark.
const PRE_HYDRATE = `(function(){try{
  var d=document.documentElement,ls=window.localStorage,mm=window.matchMedia;
  var t=ls.getItem('mellox:theme')||ls.getItem('reach-theme')||'system';
  var dark = t==='dark' || (t!=='light' && !(mm&&mm('(prefers-color-scheme: light)').matches));
  d.classList.toggle('dark', dark);
  var den=ls.getItem('chat-density'); d.dataset.chatDensity=(den==='compact'||den==='comfortable')?den:'comfortable';
  var rm=ls.getItem('chat-reduced-motion');
  if(rm==='1'||rm==='0'){ d.dataset.chatMotion=rm==='1'?'reduced':'full'; }
  else { d.dataset.chatMotion=(mm&&mm('(prefers-reduced-motion: reduce)').matches)?'reduced':'full'; }
}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`dark ${googleSansFlex.variable} ${michroma.variable}`}
      style={
        {
          "--font-sans":
            "var(--font-google-sans-flex), Segoe UI, Helvetica Neue, Arial, sans-serif",
          "--font-brand": "var(--font-michroma), Segoe UI, sans-serif",
        } as React.CSSProperties
      }
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(siteGraph) }}
        />
        {/* PRE_HYDRATE script: rendered identically on server and client to
            avoid hydration mismatches. It must run BEFORE React hydrates so
            the dark class + chat density are set before paint. The script
            body is a no-op on the server (window is undefined) thanks to
            the try/catch wrapper. */}
        <script dangerouslySetInnerHTML={{ __html: PRE_HYDRATE }} />
      </head>
      <body suppressHydrationWarning>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-foreground focus:px-3 focus:py-2 focus:text-background focus:shadow-lg focus-visible:outline-none"
        >
          Skip to main content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
