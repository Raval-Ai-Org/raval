import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

const BASE_URL =
  typeof import.meta.env.VITE_APP_URL === "string" && import.meta.env.VITE_APP_URL
    ? import.meta.env.VITE_APP_URL.replace(/\/$/, "") // Remove trailing slash
    : typeof window !== "undefined"
      ? window.location.origin
      : "https://raval.ai";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [{ property: "og:url", content: `${BASE_URL}/` }],
    links: [{ rel: "canonical", href: `${BASE_URL}/` }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "Raval AI",
          url: `${BASE_URL}/`,
          applicationCategory: "BusinessApplication",
          description:
            "Raval AI is the Marketing Intelligence Layer built on your Brand DNA — plan, create and optimize with AEO/GEO intelligence and Ravi, your AI marketing analyst.",
          offers: [
            { "@type": "Offer", name: "Starter", price: "9", priceCurrency: "USD" },
            { "@type": "Offer", name: "Growth", price: "29", priceCurrency: "USD" },
            { "@type": "Offer", name: "Agency OS", price: "79", priceCurrency: "USD" },
          ],
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: [
            {
              "@type": "Question",
              name: "What is the Marketing Intelligence Layer?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "The Marketing Intelligence Layer is Raval AI's AI-native workspace where brands and agencies plan, create and optimize marketing grounded in their Brand DNA, with AEO/GEO intelligence so they get visible inside LLMs like ChatGPT, Perplexity and Gemini.",
              },
            },
            {
              "@type": "Question",
              name: "How does Raval AI use Brand DNA?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Raval AI builds every recommendation on your Brand DNA — your positioning, voice and audience — so the content, AEO and GEO optimizations it generates stay on-brand and consistent.",
              },
            },
            {
              "@type": "Question",
              name: "What is AEO/GEO and why does it matter?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "AEO (Answer Engine Optimization) and GEO (Generative Engine Optimization) help your content get cited and recommended by AI assistants. Raval AI's Ravi analyst monitors your visibility and suggests optimizations for ChatGPT, Perplexity, Gemini and Claude.",
              },
            },
          ],
        }),
      },
    ],
  }),
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        throw redirect({ to: "/app" });
      }
    } catch (e) {
      // rethrow router redirects; swallow session errors and fall through to /login
      if (e && typeof e === "object" && "isRedirect" in (e as any)) throw e;
    }
    throw redirect({ to: "/login" });
  },
  component: () => null,
});
