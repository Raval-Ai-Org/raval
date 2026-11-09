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
import {
  MAX_FILES_PER_BATCH,
  PARALLEL_UPLOADS,
  UPLOAD_MESSAGES,
  finishGroups,
  uploadProblem,
  uploadType,
  type UploadKind,
} from "@/lib/inspo/uploads";
import { toast } from "@/lib/toast";
import { userSafeMessage } from "@/lib/user-errors";
import { InspoScreen } from "./InspoScreen";
import type { InspoHandlers, InspoTaste, InspoUpload, InspoView } from "./types";

function message(cause: unknown, fallback: string) {
  return userSafeMessage(cause instanceof Error ? cause.message : null, fallback);
}

type Signed = { url: string; method: "PUT"; headers: Record<string, string> };
type Started =
  | {
      id: string;
      name: string;
      type: string;
      size: number;
      kind: UploadKind;
      upload: Signed;
      error?: undefined;
    }
  | { name: string; error: string; id?: undefined };

/** Send one file straight to storage, reporting how much has gone. */
function putFile(file: File, signed: Signed, onProgress: (share: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(signed.method, signed.url);
    for (const [name, value] of Object.entries(signed.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(UPLOAD_MESSAGES.missing));
    xhr.onerror = () => reject(new Error(UPLOAD_MESSAGES.missing));
    xhr.send(file);
  });
}

/** Run `work` over `items`, at most `limit` at a time. */
async function inTurns<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await work(items[next++]);
    }),
  );
}

/** One plain line for the files that couldn't be added. */
function failedLine(failed: { name: string; error: string }[]) {
  if (failed.length === 1) return `${failed[0].name}: ${failed[0].error}`;
  return `${failed.length} files couldn't be added. ${failed[0].name}: ${failed[0].error}`;
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

  // The brand was already scanned, so the first look at its site is read by
  // itself the first time an editor opens Inspo. It is the included first
  // analysis (no charge); a repeat is always a person's click with its price.
  const autoRead = useRef(false);
  const site = dna.websiteUrl?.trim() ?? "";
  useEffect(() => {
    if (autoRead.current || !view || !site) return;
    if (!view.available || !view.canEdit) return;
    if (view.profiles.length || view.jobs.length) return;
    autoRead.current = true;
    void perform("scan", () =>
      scanVisualWebsite({
        data: {
          workspaceId,
          url: /^https?:\/\//i.test(site) ? site : `https://${site}`,
          maxPages: 4,
          idempotencyKey: crypto.randomUUID(),
        },
      }),
    );
  }, [view, site, workspaceId, perform]);

  const call = useCallback(
    async (path: string, init: { body: BodyInit; json?: boolean }) => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Sign in again to add this.");
      const headers: Record<string, string> = { authorization: `Bearer ${session.access_token}` };
      if (init.json) headers["content-type"] = "application/json";
      const response = await fetch(
        `/api/brand-visuals/${path}?workspaceId=${encodeURIComponent(workspaceId)}`,
        { method: "POST", headers, body: init.body },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "This could not be added.");
      return result;
    },
    [workspaceId],
  );
  const send = useCallback((body: FormData) => call("upload", { body }), [call]);

  const upload = useCallback(
    async (dropped: File[], chip: InspoChip) => {
      const purpose = purposeOf(chip);
      const failed: { name: string; error: string }[] = [];
      const files = dropped.slice(0, MAX_FILES_PER_BATCH);
      if (dropped.length > files.length)
        toast.error(`Add up to ${MAX_FILES_PER_BATCH} files at a time.`);
      // The browser checks first, so a wrong file never waits for an upload.
      const typed = files.map((file) => ({ file, type: uploadType(file) }));
      const ok = typed.filter(({ file, type }) => {
        const problem = uploadProblem({ name: file.name, type, size: file.size });
        if (problem) failed.push({ name: file.name, error: problem });
        return !problem;
      });
      const showFailed = () => live.current && failed.length && setError(failedLine(failed));
      if (!ok.length) return void showFailed();

      const pending = ok.map(({ file, type }) => ({
        key: crypto.randomUUID(),
        file,
        type,
        previewUrl: type.startsWith("image/") ? URL.createObjectURL(file) : null,
      }));
      setUploads((u) => [
        ...pending.map((p) => ({
          id: p.key,
          name: p.file.name,
          previewUrl: p.previewUrl,
          chip,
          progress: 0,
        })),
        ...u,
      ]);
      const patch = (key: string, progress: number | undefined) =>
        live.current && setUploads((u) => u.map((x) => (x.id === key ? { ...x, progress } : x)));
      const done = (key: string) => {
        const p = pending.find((x) => x.key === key);
        if (p?.previewUrl) URL.revokeObjectURL(p.previewUrl);
        if (live.current) setUploads((u) => u.filter((x) => x.id !== key));
      };

      let added = 0;
      try {
        const { items } = (await call("upload/start", {
          json: true,
          body: JSON.stringify({
            files: pending.map((p) => ({ name: p.file.name, type: p.type, size: p.file.size })),
          }),
        })) as { items: Started[] };
        // The server answers in the order it was asked.
        const sent: {
          id: string;
          name: string;
          type: string;
          size: number;
          kind: UploadKind;
          key: string;
        }[] = [];
        const ready = pending.map((p, i) => ({ p, item: items[i] }));
        for (const { p, item } of ready)
          if (!item || !item.id) {
            failed.push({ name: p.file.name, error: item?.error ?? UPLOAD_MESSAGES.saveFailed });
            done(p.key);
          }
        await inTurns(
          ready.filter((r) => r.item?.id),
          PARALLEL_UPLOADS,
          async ({ p, item }) => {
            if (!item.id) return;
            try {
              await putFile(p.file, item.upload, (share) => patch(p.key, share));
              patch(p.key, undefined);
              const { upload: _signed, ...info } = item;
              sent.push({ ...info, key: p.key });
            } catch (cause) {
              failed.push({ name: p.file.name, error: message(cause, UPLOAD_MESSAGES.missing) });
              done(p.key);
            }
          },
        );
        for (const group of finishGroups(sent)) {
          try {
            const { results } = (await call("upload/finish", {
              json: true,
              body: JSON.stringify({
                purpose,
                items: group.map(({ id, name, type, size }) => ({ id, name, type, size })),
              }),
            })) as { results: { id: string; assetId?: string; error?: string }[] };
            for (const item of group) {
              const result = results.find((r) => r.id === item.id);
              if (result?.assetId) added += 1;
              else
                failed.push({
                  name: item.name,
                  error: result?.error ?? UPLOAD_MESSAGES.saveFailed,
                });
            }
          } catch (cause) {
            for (const item of group)
              failed.push({ name: item.name, error: message(cause, UPLOAD_MESSAGES.saveFailed) });
          } finally {
            group.forEach((item) => done(item.key));
            // Show each group as soon as it is saved.
            await reload();
          }
        }
      } catch (cause) {
        for (const p of pending) {
          if (!failed.some((f) => f.name === p.file.name))
            failed.push({ name: p.file.name, error: message(cause, UPLOAD_MESSAGES.saveFailed) });
          done(p.key);
        }
      }
      showFailed();
      if (added && live.current) toast.success(added > 1 ? `${added} added` : "Added");
    },
    [call, reload],
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
