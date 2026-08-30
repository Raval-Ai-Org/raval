import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Persona = "agency" | "founder" | "professional";

const CACHE_KEY = "profile:persona";

export type PersonaCopy = {
  persona: Persona;
  /** singular lowercase noun, e.g. "client" | "brand" | "project" */
  noun: string;
  /** plural lowercase, e.g. "clients" */
  nounPlural: string;
  /** capitalized singular, e.g. "Client" */
  Noun: string;
  /** capitalized plural */
  NounPlural: string;
  /** page section title */
  sectionTitle: string;
  /** headline for first-time empty state (welcome) */
  firstHeadline: (firstName?: string) => string;
  /** headline once at least one exists */
  returningHeadline: (firstName?: string) => string;
  /** subhead under headline for first-time */
  firstSubhead: string;
  /** subhead for returning */
  returningSubhead: string;
  /** button/CTA phrases */
  createCta: string;
  createFirstCta: string;
  mandatoryTitle: string;
  mandatoryDescription: string;
  normalTitle: string;
  normalDescription: string;
  nameLabel: string;
  namePlaceholder: string;
  deletePromptTitle: string;
  searchPlaceholder: string;
};

export const COPY: Record<Persona, PersonaCopy> = {
  agency: {
    persona: "agency",
    noun: "client",
    nounPlural: "clients",
    Noun: "Client",
    NounPlural: "Clients",
    sectionTitle: "Clients",
    firstHeadline: (n) => `Welcome${n ? `, ${n}` : ""} — add your first client`,
    returningHeadline: (n) => `Which client today${n ? `, ${n}` : ""}?`,
    firstSubhead:
      "Paste a website link to spin up a real client workspace — we'll set up Brand DNA, AEO/GEO and Ravi in seconds.",
    returningSubhead: "Pick a client brand to work on, or onboard a new one.",
    createCta: "New client",
    createFirstCta: "Create client",
    mandatoryTitle: "Add your first client",
    mandatoryDescription:
      "Every brand you work on lives in its own workspace. Name your first client to get started — you can add more anytime.",
    normalTitle: "New client",
    normalDescription: "Name the client and (optionally) attach a website.",
    nameLabel: "Client name",
    namePlaceholder: "e.g. Acme Marketing",
    deletePromptTitle: "Remove this client?",
    searchPlaceholder: "Search clients",
  },
  founder: {
    persona: "founder",
    noun: "brand",
    nounPlural: "brands",
    Noun: "Brand",
    NounPlural: "Brands",
    sectionTitle: "Brands",
    firstHeadline: (n) => `Welcome${n ? `, ${n}` : ""} — set up your brand`,
    returningHeadline: (n) => `Which brand today${n ? `, ${n}` : ""}?`,
    firstSubhead:
      "Paste your website link and we'll set up Brand DNA, AEO/GEO and Ravi around your brand in seconds.",
    returningSubhead: "Open your brand or add another one you run.",
    createCta: "New brand",
    createFirstCta: "Create brand",
    mandatoryTitle: "Set up your brand",
    mandatoryDescription:
      "Your brand lives in its own workspace with Brand DNA, memory and Ravi. Name it to get started.",
    normalTitle: "Add a brand",
    normalDescription: "Name the brand and (optionally) attach a website.",
    nameLabel: "Brand name",
    namePlaceholder: "e.g. Acme",
    deletePromptTitle: "Remove this brand?",
    searchPlaceholder: "Search brands",
  },
  professional: {
    persona: "professional",
    noun: "project",
    nounPlural: "projects",
    Noun: "Project",
    NounPlural: "Projects",
    sectionTitle: "Projects",
    firstHeadline: (n) => `Welcome${n ? `, ${n}` : ""} — start your first project`,
    returningHeadline: (n) => `Which project today${n ? `, ${n}` : ""}?`,
    firstSubhead:
      "Paste a website link to spin up a project — Brand DNA, AEO/GEO and Ravi in seconds.",
    returningSubhead: "Pick a project to work on, or start a new one.",
    createCta: "New project",
    createFirstCta: "Create project",
    mandatoryTitle: "Start your first project",
    mandatoryDescription:
      "Each project you work on lives in its own workspace. Name your first one to get started.",
    normalTitle: "New project",
    normalDescription: "Name the project and (optionally) attach a website.",
    nameLabel: "Project name",
    namePlaceholder: "e.g. Q1 Launch",
    deletePromptTitle: "Remove this project?",
    searchPlaceholder: "Search projects",
  },
};

function readCache(): Persona | null {
  try {
    const v = localStorage.getItem(CACHE_KEY);
    if (v === "agency" || v === "founder" || v === "professional") return v;
  } catch {}
  return null;
}

export function usePersona() {
  const [persona, setPersonaState] = useState<Persona | null>(readCache());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        if (!cancelled) setLoading(false);
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("persona")
        .eq("id", sess.session.user.id)
        .maybeSingle();
      if (cancelled) return;
      const p = (data?.persona ?? null) as Persona | null;
      setPersonaState(p);
      try {
        if (p) localStorage.setItem(CACHE_KEY, p);
        else localStorage.removeItem(CACHE_KEY);
      } catch {}
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setPersona = useCallback(
    async (p: Persona) => {
      // Client-side guard — cheap short-circuit for the common case.
      if (persona) return;
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) throw new Error("Not signed in");

      // Atomic first-writer-wins via SECURITY DEFINER RPC. Concurrent calls
      // (multiple tabs, double-tap, retry after a network hiccup) all resolve
      // to the same persisted value — the DB serializes the UPDATE and
      // subsequent callers observe the already-set persona.
      const { data, error } = await supabase.rpc("set_persona_once", { _persona: p }).maybeSingle();
      if (error) throw error;

      const persisted = (data?.persona ?? p) as Persona;
      try {
        localStorage.setItem(CACHE_KEY, persisted);
      } catch {}
      setPersonaState(persisted);
    },
    [persona],
  );

  const copy = COPY[persona ?? "agency"];
  return { persona, copy, loading, setPersona };
}
