import { supabase } from "@/integrations/supabase/client";
import { authedFetch } from "@/lib/authed-fetch";
import type {
  BrandDna,
  Competitor,
  MemoryNote,
  SignalEvidence,
} from "@/hooks/use-brand-dna";

const uid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const similar = (a: string, b: string) => {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // crude containment dedup
  return x.includes(y) || y.includes(x);
};

interface ExtractedMemory {
  insights?: { title: string; body: string }[];
  competitors?: Partial<Competitor>[];
  triggerSignals?: { text: string; sourceLabel?: string }[];
  objectionSignals?: { text: string; sourceLabel?: string }[];
  feedbackSources?: { text: string; sourceLabel?: string }[];
  brand?: Partial<BrandDna>;
}

export async function syncMemoryFromChat(
  workspaceId: string,
  dna: BrandDna,
  save: (next: Partial<BrandDna>) => void,
): Promise<{ added: number; skipped?: string }> {
  // Pull recent chat history from Supabase (RLS-scoped).
  const { data, error } = await supabase
    .from("chat_messages")
    .select("role,content,created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true })
    .limit(60);

  if (error || !data || data.length === 0) {
    return { added: 0, skipped: "no chat history" };
  }

  const messages = (data as { role: string; content: string }[])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .filter((m) => typeof m.content === "string" && m.content.trim().length > 0)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content.slice(0, 8000),
    }));

  if (messages.length === 0) return { added: 0, skipped: "empty" };

  const known = {
    brandName: dna.brandName || undefined,
    oneLiner: dna.oneLiner || undefined,
    knownInsights: dna.userInsights.map((n) => `${n.title}: ${n.body}`),
    knownCompetitors: dna.competitors.map((c) => c.name).filter(Boolean) as string[],
    knownTriggers: dna.customer.triggerSignals.map((s) => s.text),
    knownObjections: dna.customer.objectionSignals.map((s) => s.text),
    knownFeedback: dna.customer.feedbackSources.map((s) => s.text),
  };

  const res = await authedFetch("/api/memory-extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, current: known }),
  });

  if (!res.ok) {
    return { added: 0, skipped: `extract failed (${res.status})` };
  }

  const out = (await res.json()) as ExtractedMemory;

  let added = 0;
  const now = Date.now();

  // Insights — dedup against existing titles/bodies.
  const newInsights: MemoryNote[] = [];
  for (const ins of out.insights ?? []) {
    if (!ins.title?.trim() && !ins.body?.trim()) continue;
    const blob = `${ins.title} ${ins.body}`;
    if (dna.userInsights.some((n) => similar(`${n.title} ${n.body}`, blob))) continue;
    newInsights.push({
      id: uid(),
      title: ins.title?.trim() || "Insight",
      body: ins.body?.trim() || "",
      createdAt: now,
      source: "chat",
    });
    added++;
  }

  // Competitors — dedup by name.
  const newCompetitors: Competitor[] = [];
  for (const c of out.competitors ?? []) {
    if (!c.name?.trim()) continue;
    if (dna.competitors.some((existing) => similar(existing.name, c.name!))) continue;
    newCompetitors.push({
      id: uid(),
      name: c.name.trim(),
      url: c.url?.trim() || undefined,
      positioning: c.positioning?.trim() || undefined,
      strengths: c.strengths?.trim() || undefined,
      weaknesses: c.weaknesses?.trim() || undefined,
      notes: c.notes?.trim() || undefined,
    });
    added++;
  }

  const mergeSignals = (
    existing: SignalEvidence[],
    incoming: { text: string; sourceLabel?: string }[] | undefined,
  ) => {
    const out: SignalEvidence[] = [];
    for (const sig of incoming ?? []) {
      if (!sig.text?.trim()) continue;
      if (existing.some((s) => similar(s.text, sig.text))) continue;
      out.push({
        id: uid(),
        text: sig.text.trim(),
        sourceLabel: sig.sourceLabel?.trim() || "Chat",
        capturedAt: now,
      });
      added++;
    }
    return out;
  };

  const newTriggers = mergeSignals(dna.customer.triggerSignals, out.triggerSignals);
  const newObjections = mergeSignals(dna.customer.objectionSignals, out.objectionSignals);
  const newFeedback = mergeSignals(dna.customer.feedbackSources, out.feedbackSources);

  // Brand patch — only fill blanks; never overwrite existing user-provided fields.
  const brandPatch: Partial<BrandDna> = {};
  if (out.brand) {
    const keys: (keyof BrandDna)[] = [
      "brandName",
      "oneLiner",
      "voice",
      "audience",
      "uniqueValueProp",
      "mission",
      "vision",
      "positioning",
      "doRules",
      "dontRules",
    ];
    for (const k of keys) {
      const val = (out.brand as any)[k];
      if (typeof val === "string" && val.trim() && !((dna as any)[k] || "").trim()) {
        (brandPatch as any)[k] = val.trim();
        added++;
      }
    }
  }

  if (
    newInsights.length === 0 &&
    newCompetitors.length === 0 &&
    newTriggers.length === 0 &&
    newObjections.length === 0 &&
    newFeedback.length === 0 &&
    Object.keys(brandPatch).length === 0
  ) {
    save({ memoryLastMsgCount: messages.length, memoryUpdatedAt: now });
    return { added: 0 };
  }

  save({
    ...brandPatch,
    userInsights: [...newInsights, ...dna.userInsights].slice(0, 80),
    competitors: [...dna.competitors, ...newCompetitors],
    customer: {
      ...dna.customer,
      triggerSignals: [...dna.customer.triggerSignals, ...newTriggers],
      objectionSignals: [...dna.customer.objectionSignals, ...newObjections],
      feedbackSources: [...dna.customer.feedbackSources, ...newFeedback],
    },
    memoryLastMsgCount: messages.length,
    memoryUpdatedAt: now,
  });

  // Best-effort persistence to the workspace memory_insights table for cross-
  // device availability + future LLM grounding. Failures are non-fatal.
  try {
    const items: { body: string; kind: string; sourceLabel?: string }[] = [
      ...newInsights.map((n) => ({
        body: n.title ? `${n.title}: ${n.body}` : n.body,
        kind: "insight",
        sourceLabel: "Chat",
      })),
      ...newTriggers.map((t) => ({ body: t.text, kind: "trigger", sourceLabel: t.sourceLabel })),
      ...newObjections.map((o) => ({ body: o.text, kind: "objection", sourceLabel: o.sourceLabel })),
      ...newFeedback.map((f) => ({ body: f.text, kind: "feedback", sourceLabel: f.sourceLabel })),
      ...newCompetitors.map((c) => ({
        body: `Competitor: ${c.name}${c.positioning ? ` — ${c.positioning}` : ""}`,
        kind: "competitor",
        sourceLabel: "Chat",
      })),
    ].filter((x) => x.body && x.body.trim().length >= 3);

    if (items.length > 0) {
      const { upsertMemoryInsights } = await import("@/lib/insights.functions");
      await upsertMemoryInsights({ data: { workspaceId, items } }).catch(() => {});
    }
  } catch { /* noop */ }

  return { added };
}
