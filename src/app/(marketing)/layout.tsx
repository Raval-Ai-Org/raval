import type { Metadata, Viewport } from "next";
import { Google_Sans_Flex, Michroma, Micro_5 } from "next/font/google";
import "@/marketing/globals.css";
import Analytics from "@/marketing/components/Analytics";
import MotionGate from "@/marketing/components/MotionGate";
import Preloader from "@/marketing/components/Preloader";
import SmoothScroll from "@/marketing/components/SmoothScroll";
import CookieBanner from "@/marketing/components/legal/CookieBanner";
import JsonLd from "@/marketing/components/JsonLd";
import { SITE_DESCRIPTION, SITE_KEYWORDS, SITE_URL, siteGraph } from "@/marketing/lib/seo";

const michroma = Michroma({ variable: "--font-michroma", weight: "400", subsets: ["latin"] });
const micro5 = Micro_5({ variable: "--font-micro5", weight: "400", subsets: ["latin"], preload: false });
const googleSansFlex = Google_Sans_Flex({ variable: "--font-google-sans-flex", subsets: ["latin"] });
const PRELOADER_SKIP_SCRIPT =
  "try{if(sessionStorage.getItem('mx-preloaded')||matchMedia('(pointer: coarse), (hover: none)').matches)document.documentElement.setAttribute('data-preloaded','1')}catch(e){}";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Mellox AI", template: "%s | Mellox AI" },
  description: SITE_DESCRIPTION,
  keywords: SITE_KEYWORDS,
  category: "technology",
  applicationName: "Mellox AI",
  robots: { index: true, follow: true },
  icons: {
    icon: [{ url: "/marketing/icon.svg", type: "image/svg+xml" }, { url: "/marketing/favicon.ico" }],
    apple: [{ url: "/marketing/apple-icon.png" }],
  },
  openGraph: { siteName: "Mellox AI", type: "website", images: ["/marketing/opengraph-image.png"] },
  twitter: { card: "summary_large_image", images: ["/marketing/twitter-image.png"] },
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || undefined,
    other: process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION
      ? { "msvalidate.01": process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION }
      : undefined,
  },
};

export const viewport: Viewport = { themeColor: "#0d1114" };

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div id="main-content" className={`${michroma.variable} ${googleSansFlex.variable} ${micro5.variable} flex min-h-screen flex-col font-sans`}>
      <script dangerouslySetInnerHTML={{ __html: PRELOADER_SKIP_SCRIPT }} />
      <noscript><style>{".mx-pre{display:none!important}"}</style></noscript>
      <Preloader />
      <MotionGate />
      <SmoothScroll />
      <JsonLd data={siteGraph} />
      {children}
      <CookieBanner />
      <Analytics />
    </div>
  );
}
