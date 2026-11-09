"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authedFetch } from "@/lib/authed-fetch";
import { getVisualTaste, updateVisualReference } from "@/lib/brand-visuals.functions";
import { IMAGE_TYPES, UPLOAD_MESSAGES } from "@/lib/inspo/uploads";
import { normalizeSiteUrl } from "@/lib/onboarding/manual-brand";

// Inspiration during the no-website setup: each picture or link becomes an
// Inspo "Love" reference (brand_visual_sources, purpose `style`) through the
// same upload route Inspo uses, so it shows on the Inspo board afterwards and
// Studio's look reads it. Uploading is free; "Learn my style" stays a click in Inspo.

export const MAX_INSPIRATIONS = 8;
/** The route reads one form of at most 22 MB. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export type InspoItem = {
  key: string;
  label: string;
  /** A local preview (object URL) for files; null for links. */
  preview: string | null;
  link: string | null;
  status: "uploading" | "done" | "error";
  assetId?: string;
  error?: string;
};

const keyOf = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

export function useManualInspiration(workspaceId: string | null) {
  const [items, setItems] = useState<InspoItem[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(
    () => () => {
      for (const item of itemsRef.current) if (item.preview) URL.revokeObjectURL(item.preview);
    },
    [],
  );

  const patch = (key: string, next: Partial<InspoItem>) =>
    setItems((list) => list.map((item) => (item.key === key ? { ...item, ...next } : item)));

  const send = useCallback(
    async (key: string, form: FormData) => {
      if (!workspaceId) return;
      form.set("purpose", "style");
      try {
        const response = await authedFetch(
          `/api/brand-visuals/upload?workspaceId=${encodeURIComponent(workspaceId)}`,
          { method: "POST", body: form },
        );
        const json = (await response.json().catch(() => ({}))) as {
          assetId?: string;
          error?: string;
        };
        if (!response.ok || !json.assetId)
          throw new Error(json.error || UPLOAD_MESSAGES.saveFailed);
        patch(key, { status: "done", assetId: json.assetId });
      } catch (error) {
        patch(key, {
          status: "error",
          error: error instanceof Error ? error.message : UPLOAD_MESSAGES.saveFailed,
        });
      }
    },
    [workspaceId],
  );

  /** Returns why some files were left out, or null. */
  const addFiles = useCallback(
    (files: File[]): string | null => {
      const room = MAX_INSPIRATIONS - itemsRef.current.length;
      let problem: string | null = null;
      const accepted: File[] = [];
      for (const file of files) {
        if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) {
          problem = "Use PNG, JPEG or WebP pictures.";
          continue;
        }
        if (file.size > MAX_IMAGE_BYTES) {
          problem = "Pictures up to 20 MB here. Bigger ones fit in Inspo later.";
          continue;
        }
        accepted.push(file);
      }
      if (accepted.length > room)
        problem = `Up to ${MAX_INSPIRATIONS} for now. Add more in Inspo later.`;
      const chosen = accepted.slice(0, Math.max(0, room));
      const added = chosen.map((file) => ({
        file,
        item: {
          key: keyOf(),
          label: file.name.slice(0, 100),
          preview: URL.createObjectURL(file),
          link: null,
          status: "uploading" as const,
        },
      }));
      if (added.length) setItems((list) => [...list, ...added.map((a) => a.item)]);
      for (const { file, item } of added) {
        const form = new FormData();
        form.set("file", file);
        form.set("label", item.label);
        void send(item.key, form);
      }
      return problem;
    },
    [send],
  );

  const addLink = useCallback(
    (raw: string): string | null => {
      const url = normalizeSiteUrl(raw);
      if (!url) return "Paste a full link, like instagram.com/p/…";
      if (itemsRef.current.length >= MAX_INSPIRATIONS)
        return `Up to ${MAX_INSPIRATIONS} for now. Add more in Inspo later.`;
      if (itemsRef.current.some((item) => item.link === url)) return "Already added.";
      const item: InspoItem = {
        key: keyOf(),
        label: new URL(url).hostname.replace(/^www\./, ""),
        preview: null,
        link: url,
        status: "uploading",
      };
      setItems((list) => [...list, item]);
      const form = new FormData();
      form.set("sourceUrl", url);
      void send(item.key, form);
      return null;
    },
    [send],
  );

  const remove = useCallback(
    async (key: string) => {
      const item = itemsRef.current.find((i) => i.key === key);
      if (!item) return;
      setItems((list) => list.filter((i) => i.key !== key));
      if (item.preview) URL.revokeObjectURL(item.preview);
      if (!workspaceId || !item.assetId) return;
      // The upload answers with the asset; the reference row is found by it.
      try {
        const view = await getVisualTaste({ data: { workspaceId } });
        const source = view.sources.find((s) => s.asset_id === item.assetId);
        if (source)
          await updateVisualReference({
            data: { workspaceId, id: source.id, status: "removed" },
          });
      } catch {
        // It stays on the Inspo board, where it can be removed later.
      }
    },
    [workspaceId],
  );

  const retry = useCallback(
    (key: string) => {
      const item = itemsRef.current.find((i) => i.key === key);
      if (!item?.link) {
        setItems((list) => list.filter((i) => i.key !== key));
        return;
      }
      patch(key, { status: "uploading", error: undefined });
      const form = new FormData();
      form.set("sourceUrl", item.link);
      void send(key, form);
    },
    [send],
  );

  return {
    items,
    addFiles,
    addLink,
    remove,
    retry,
    saved: items.filter((i) => i.status === "done").length,
  };
}
