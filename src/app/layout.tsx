import type { Metadata, Viewport } from "next";
import { BASE_URL, BRAND_NAME } from "@/lib/seo";
import { Providers } from "@/app/providers";

import "@/styles.css";

import faviconAsset from "@/assets/mellox-logo.svg.asset.json";

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
    icon: [{ url: faviconAsset.url, type: "image/svg+xml", sizes: "any" }],
    apple: [{ url: faviconAsset.url, type: "image/svg+xml" }],
  },
  openGraph: {
    title: "Mellox AI | Marketing Intelligence Layer",
    description:
      "Get visible inside LLMs. Mellox AI is the AI-native marketing platform for brands and agencies — plan, create, optimize and grow from one workspace grounded in your Brand DNA.",
    siteName: "Mellox AI",
    type: "website",
    images: [{ url: `${BASE_URL}${faviconAsset.url}`, type: "image/svg+xml" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Mellox AI | Marketing Intelligence Layer",
    description:
      "Get visible inside LLMs. Mellox AI is the AI-native marketing platform for brands and agencies — plan, create, optimize and grow from one workspace grounded in your Brand DNA.",
    images: [{ url: `${BASE_URL}${faviconAsset.url}`, type: "image/svg+xml" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { color: "#0f1411", media: "(prefers-color-scheme: dark)" },
    { color: "#f7f8fa", media: "(prefers-color-scheme: light)" },
  ],
};

const ORGANIZATION_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${BASE_URL}/#organization`,
      name: "Mellox AI",
      url: BASE_URL,
      logo: {
        "@type": "ImageObject",
        url: `${BASE_URL}${faviconAsset.url}`,
      },
      description:
        "Mellox AI is the Marketing Intelligence Layer — an AI-native platform that helps brands and agencies get visible inside LLMs.",
      sameAs: [],
    },
    {
      "@type": "WebSite",
      "@id": `${BASE_URL}/#website`,
      url: BASE_URL,
      name: "Mellox AI",
      description:
        "Get visible inside LLMs. The AI-native marketing platform for brands and agencies.",
      publisher: { "@id": `${BASE_URL}/#organization` },
      inLanguage: "en",
    },
  ],
};

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <meta property="og:site_name" content={BRAND_NAME} />
        <meta property="og:type" content="website" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Google+Sans+Flex:opsz,wght@8..144,100..1000&family=Michroma:wght@400&display=swap"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,300..600,0..1,-25..0&display=swap"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ORGANIZATION_LD) }}
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
