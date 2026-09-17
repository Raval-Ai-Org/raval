// notes-writer.server.ts — "Write it for me" for a creator video ad's creative
// notes. Grounded: the only product claims it may use are the saved product
// facts; everything scraped is fenced as untrusted data. A random creative
// direction per call keeps repeated clicks fresh.
import "server-only";
import { z } from "zod";
import { runStructuredPrompt } from "@/lib/ai";
import { serializeBrandContext, type BrandCtxDna } from "@/lib/ai/brand-context";
import {
  CREATOR_AGES,
  CREATOR_GENDERS,
  CREATOR_VIBES,
  FORMATS,
  OBJECTIVES,
  PLATFORMS,
  SETTINGS,
  TONES,
  labelOf,
} from "@/lib/ugc/options";
import type { Brief, Product } from "@/lib/ugc/schemas";
import { pickSparks } from "@/lib/studio/prompt-writer";
import { sections } from "@/lib/studio/prompts";
import { UNTRUSTED_DATA_RULE, wrapUntrusted } from "@/server/guardrails/untrusted";

export const NOTES_MAX_CHARS = 1000;

const NotesSchema = z.object({ notes: z.coerce.string().min(120) });

export async function writeCreativeNotes(args: {
  product: Product;
  brief: Brief;
  brand: Record<string, unknown>;
  workspace: { industry?: string | null; audience?: string | null };
  current?: string;
}): Promise<{ notes: string }> {
  const { product, brief } = args;
  const current = (args.current ?? "").trim();
  const sparks = pickSparks("video");

  const system = [
    "You are a top UGC (creator-style) video ad director.",
    "Write the 'creative notes' a creator and editor follow for one short vertical video ad. They sit alongside the chosen objective, platform, style, tone and presenter.",
    current
      ? "The person already wrote notes. Keep everything they asked for (and anything they said to avoid) and make the notes more detailed and complete."
      : "Invent one fresh, specific, scroll-stopping direction for this product.",
    "Use these labelled lines, each on its own line: 'Opening hook:', 'Story flow:', 'Show on camera:', 'Presenter direction:', 'Setting and look:', 'Must include:', 'Avoid:'.",
    "Be concrete and filmable: exact hook line or action, what hands and face do, how and when the product appears, props, lighting, pacing.",
    "Only claim what appears in the product facts. Never invent results, numbers, prices, discounts, reviews or certifications. Add 'Avoid: unsupported claims' if relevant.",
    `Keep the whole thing under ${NOTES_MAX_CHARS - 60} characters. Plain everyday language.`,
    UNTRUSTED_DATA_RULE,
    'Return STRICT JSON only: {"notes": string}',
  ].join("\n");

  const facts = product.facts.map((f) => `- ${f.text}`).join("\n");
  const user = sections([
    {
      label: "Product",
      body: wrapUntrusted(
        "product",
        [
          `Name: ${product.name}`,
          product.brand && `Brand: ${product.brand}`,
          product.category && `Category: ${product.category}`,
          product.price && `Price: ${product.price}`,
          product.description && `Description: ${product.description}`,
          product.benefits.length && `Benefits: ${product.benefits.join("; ")}`,
          product.useCases.length && `Use cases: ${product.useCases.join("; ")}`,
          product.audienceHints.length && `Audience hints: ${product.audienceHints.join("; ")}`,
        ]
          .filter(Boolean)
          .join("\n"),
        { maxChars: 3000, route: "ugc.notes" },
      ),
    },
    {
      label: "Product facts (the only claims allowed)",
      body: facts
        ? wrapUntrusted("facts", facts, { maxChars: 3000, route: "ugc.notes" })
        : "None saved — make no specific claims.",
    },
    {
      label: "Brief",
      body: [
        `Objective: ${labelOf(OBJECTIVES, brief.objective)}`,
        `Platform: ${labelOf(PLATFORMS, brief.platform)}`,
        `Video style: ${labelOf(FORMATS, brief.format)}`,
        `Tone: ${labelOf(TONES, brief.tone)}`,
        brief.audience && `Audience: ${brief.audience}`,
        brief.cta && `Call to action: ${brief.cta}`,
        `Presenter: ${labelOf(CREATOR_GENDERS, brief.creator.gender)}, ${labelOf(CREATOR_AGES, brief.creator.age)}, ${labelOf(CREATOR_VIBES, brief.creator.vibe)}`,
        `Setting: ${labelOf(SETTINGS, brief.creator.setting)}`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
    {
      label: "Brand",
      body: wrapUntrusted("brand", serializeBrandContext(args.brand as BrandCtxDna), {
        maxChars: 3000,
        route: "ugc.notes",
      }),
    },
    {
      label: "Business",
      body: [
        args.workspace.industry && `Industry: ${args.workspace.industry}`,
        args.workspace.audience && `Audience: ${args.workspace.audience}`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
    { label: "Creative direction for this one", body: sparks.map((s) => `- ${s}`).join("\n") },
    {
      label: "Current notes (keep what they ask for)",
      body: current ? wrapUntrusted("notes", current, { route: "ugc.notes" }) : "",
    },
    { label: "Request", body: `Variation ${Math.random().toString(36).slice(2, 10)}` },
  ]);

  const parsed = await runStructuredPrompt({
    route: "ugc.notes",
    system,
    user,
    schema: NotesSchema,
    maxTokens: 700,
    temperature: 1,
    noCache: true,
    regenerate: true,
  });

  const notes = parsed.notes
    .replace(/\r\n?/g, "\n")
    .replace(/^[ \t]*#{1,6}[ \t]*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { notes: notes.slice(0, NOTES_MAX_CHARS) };
}
