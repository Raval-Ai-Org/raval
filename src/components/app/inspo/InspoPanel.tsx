"use client";

// Inspo's data (ADR-0037): the one look on Brand DNA (`dna.look`) and the
// brand's visual references (`brand_visual_sources`). Nothing here starts a
// paid step by itself: "Learn my style" is a person's click with the price on
// the button, and a direction is used only after a person picks it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBrandDna } from "@/hooks/use-brand-dna";
import { emitAppEvent } from "@/lib/app-events";
import {
  getVisualTaste,
  learnVisualReferences,
  restoreManualVisualLook,
  saveVisualDirection,
  scanVisualWebsite,
  updateVisualReference,
} from "@/lib/brand-visuals.functions";
import type { VisualProfile, VisualView } from "@/lib/brand-visuals/contracts";
import { creditsFor } from "@/lib/billing/catalog";
import { parseLook } from "@/lib/brand-look/spec";
import {
  inspoCards,
  purposeOf,
  studioReferenceMode,
  type InspoCard,
  type InspoChip,
} from "@/lib/inspo/board";
import { tidyLook } from "@/lib/inspo/look";
import type { InspoSection } from "@/lib/inspo/sections";
import { toast } from "@/lib/toast";
import { userSafeMessage } from "@/lib/user-errors";
import { InspoScreen } from "./InspoScreen";
import type { InspoHandlers, InspoTaste, InspoUpload, InspoView } from "./types";

const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPTED = /^(image\/(png|jpeg|webp)|video\/(mp4|webm))$/;

function message(cause: unknown, fallback: string) {
  return userSafeMessage(cause instanceof Error ? cause.message : null, fallback);
}

export function tasteOf(view: VisualView | null, draft: VisualProfile | null): InspoTaste | null {
  if (!view) return null;
  const newest = view.profiles[0];
  const active = view.profiles.find((p) => p.id === view.activeId);
  const running = view.jobs.find((j) => j.status === "queued" || j.status === "running");
  return {
    available: view.available,
    canEdit: view.canEdit,
    sources: view.sources,
    draft:
      newest && newest.status === "candidate" && draft ? { id: newest.id, profile: draft } : null,
    active: active
      ? {
          id: active.id,
          name: active.profile.directions[active.profile.selected]?.name ?? "Your style",
        }
      : null,
    running: running ? { stage: running.stage, pages: running.next_page } : null,
    // Older rows may still hold raw browser text: show only a plain sentence.
    lastError:
      !running && view.jobs[0]?.error
        ? userSafeMessage(
            view.jobs[0].error,
            "We couldn't look at your site's pages just now. Please try again.",
          )
        : null,
    learnPrice: view.profiles.length ? creditsFor("brand_dna_rescan") : 0,
  };
}

export function InspoPanel({
  workspaceId,
  section,
  onSection,
}: {
  workspaceId: string;
  section: InspoSection;
  onSection: (section: InspoSection) => void;
}) {
  const { dna, save } = useBrandDna(workspaceId);
  const look = useMemo(() => parseLook(dna.look), [dna.look]);
  const [view, setView] = useState<VisualView | null>(null);
  const [draft, setDraft] = useState<VisualProfile | null>(null);
  const [uploads, setUploads] = useState<InspoUpload[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState<InspoCard | null>(null);
  const live = useRef(true);

  const reload = useCallback(async () => {
    try {
      const next = await getVisualTaste({ data: { workspaceId } });
      if (live.current) setView(next);
    } catch (cause) {
      if (live.current) setError(message(cause, "Your inspo could not be loaded."));
    }
  }, [workspaceId]);

  useEffect(() => {
    live.current = true;
    void reload();
    return () => {
      live.current = false;
    };
  }, [reload]);

  // While an analysis runs, read it again every few seconds.
  const runningId = view?.jobs.find((j) => j.status === "queued" || j.status === "running")?.id;
  useEffect(() => {
    if (!runningId) return;
    const timer = setInterval(() => void reload(), 4000);
    return () => clearInterval(timer);
  }, [runningId, reload]);

  // A new analysis becomes the draft the person picks from.
  const newest = view?.profiles[0];
  const draftOf = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (newest && draftOf.current !== newest.id) {
      draftOf.current = newest.id;
      setDraft(newest.profile);
    }
  }, [newest]);

  // Undo is offered for a few seconds.
  useEffect(() => {
    if (!removed) return;
    const timer = setTimeout(() => setRemoved(null), 6000);
    return () => clearTimeout(timer);
  }, [removed]);

  const perform = useCallback(async (name: string, action: () => Promise<VisualView>) => {
    setBusy(name);
    setError(null);
    try {
      const next = await action();
      if (live.current) setView(next);
      return true;
    } catch (cause) {
      if (live.current) setError(message(cause, "That change could not be saved."));
      return false;
    } finally {
      if (live.current) setBusy(null);
    }
  }, []);

  const send = useCallback(
    async (body: FormData) => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Sign in again to add this.");
      const response = await fetch(
        `/api/brand-visuals/upload?workspaceId=${encodeURIComponent(workspaceId)}`,
        { method: "POST", headers: { authorization: `Bearer ${session.access_token}` }, body },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "This could not be added.");
    },
    [workspaceId],
  );

  const upload = useCallback(
    async (files: File[], chip: InspoChip) => {
      const ok = files.filter((f) => ACCEPTED.test(f.type) && f.size > 0 && f.size <= MAX_BYTES);
      if (ok.length < files.length)
        toast.error("Use PNG, JPEG, WebP, MP4 or WebM, up to 20 MB each.");
      if (!ok.length) return;
      const pending = ok.map((file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
        chip,
        file,
      }));
      setUploads((u) => [...pending.map(({ file: _f, ...p }) => p), ...u]);
      let added = 0;
      for (const p of pending) {
        try {
          const body = new FormData();
          body.set("workspaceId", workspaceId);
          body.set("purpose", purposeOf(chip));
          body.set("format", "all");
          body.set("label", p.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 100) || "Inspo");
          body.set("file", p.file);
          await send(body);
          added += 1;
        } catch (cause) {
          if (live.current) setError(message(cause, `${p.name} could not be added.`));
        } finally {
          if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
          if (live.current) setUploads((u) => u.filter((x) => x.id !== p.id));
        }
        // Show each one as soon as it is saved.
        await reload();
      }
      if (added && live.current) toast.success(added > 1 ? `${added} added` : "Added");
    },
    [workspaceId, send, reload],
  );

  const addLink = useCallback(
    async (url: string, chip: InspoChip) => {
      const id = crypto.randomUUID();
      setUploads((u) => [{ id, name: url, previewUrl: null, chip }, ...u]);
      try {
        const body = new FormData();
        body.set("workspaceId", workspaceId);
        body.set("purpose", purposeOf(chip));
        body.set("format", "all");
        body.set("sourceUrl", url);
        await send(body);
        await reload();
      } catch (cause) {
        if (live.current) setError(message(cause, "That link could not be added."));
      } finally {
        if (live.current) setUploads((u) => u.filter((x) => x.id !== id));
      }
    },
    [workspaceId, send, reload],
  );

  const sourceById = useCallback((id: string) => view?.sources.find((s) => s.id === id), [view]);

  // A video's frames follow it, so they never linger as their own cards.
  const setStatus = useCallback(
    async (card: InspoCard, status: "approved" | "removed", purpose?: InspoChip) => {
      let next: VisualView | null = null;
      for (const id of [card.id, ...card.frameIds]) {
        const s = sourceById(id);
        next = await updateVisualReference({
          data: {
            workspaceId,
            id,
            status,
            purpose: purpose ? purposeOf(purpose, s?.purpose) : undefined,
          },
        });
      }
      if (!next) throw new Error("Nothing to change.");
      return next;
    },
    [workspaceId, sourceById],
  );

  const handlers: InspoHandlers = {
    onSection,
    saveLook: (next) => save({ look: tidyLook(next) }),
    resetLook: () => save({ look: undefined }),
    upload: (files, chip) => void upload(files, chip),
    addLink: (url, chip) => void addLink(url, chip),
    setChip: (card, chip) => {
      if (card.chip === chip) return;
      void perform("chip", () => setStatus(card, "approved", chip));
    },
    remove: (card) =>
      void perform("remove", () => setStatus(card, "removed")).then((ok) => ok && setRemoved(card)),
    undo: () => {
      const card = removed;
      if (!card) return;
      setRemoved(null);
      void perform("undo", () => setStatus(card, "approved"));
    },
    learn: () =>
      void perform("learn", () =>
        learnVisualReferences({ data: { workspaceId, idempotencyKey: crypto.randomUUID() } }),
      ),
    learnFromSite: () => {
      const url = dna.websiteUrl?.trim();
      if (!url) return;
      void perform("scan", () =>
        scanVisualWebsite({
          data: {
            workspaceId,
            url: /^https?:\/\//i.test(url) ? url : `https://${url}`,
            maxPages: 4,
            idempotencyKey: crypto.randomUUID(),
          },
        }),
      );
    },
    pickDirection: (index) => setDraft((d) => (d ? { ...d, selected: index } : d)),
    useDirection: () => {
      if (!draft) return;
      void perform("direction", () =>
        saveVisualDirection({
          data: {
            workspaceId,
            profile: draft,
            expectedActiveId: view?.activeId ?? null,
            confirm: true,
          },
        }),
      ).then((ok) => ok && toast.success("Style saved"));
    },
    stopDirection: () =>
      void perform("manual", () =>
        restoreManualVisualLook({
          data: { workspaceId, expectedActiveId: view?.activeId ?? null },
        }),
      ),
    useInPost: (card) => {
      const mode = studioReferenceMode(card.chip);
      if (!mode) return;
      if (card.kind === "video")
        emitAppEvent("open:canvas", {
          type: "video",
          sourceVideoAssetIds: [card.assetId],
          videoMode: "brand",
        });
      else
        emitAppEvent("open:canvas", {
          type: "social",
          referenceAssetIds: [card.assetId],
          referenceMode: mode,
        });
    },
    openBrand: (tab) => emitAppEvent("open:brain", { section: "brand", tab }),
    dismissError: () => setError(null),
  };

  const cards = useMemo(() => inspoCards(view?.sources ?? []), [view]);
  const inspo: InspoView = {
    dna,
    look,
    cards,
    taste: tasteOf(view, draft),
    uploads,
    busy,
    error,
    removed,
  };
  return <InspoScreen view={inspo} section={section} handlers={handlers} />;
}
