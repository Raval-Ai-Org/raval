"use client";
// Query keys and mutations for the Brand Kit.
//
// Every key carries the workspace id, so the workspace provider drops them on
// a switch and one brand's styles never render under another.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  addWritingSample,
  analyzeKitAssets,
  archiveStyle,
  createStyle,
  deleteKitAsset,
  describeStyle,
  duplicateStyle,
  getBrandKit,
  listStyleOptions,
  previewStylePrompt,
  setDefaultStyle,
  suggestStyle,
  updateKitAsset,
  updateStyle,
} from "@/lib/brand-kit.functions";
import type { BrandKitOverview, BrandStyleView } from "@/lib/brand-kit/contracts";
import type { KitAssetKind, StyleFormat, StyleSpec } from "@/lib/brand-kit/spec";
import { emitAppEvent } from "@/lib/app-events";
import { readBrandDnaFor, saveBrandDnaFor, type BrandDna } from "@/hooks/use-brand-dna";
import { parseStyleSpec } from "@/lib/brand-kit/spec";
import { uploadKitFile } from "./upload";

export const brandKitKeys = {
  all: (ws: string | null) => ["brand-kit", ws] as const,
  overview: (ws: string | null) => ["brand-kit", ws, "overview"] as const,
  options: (ws: string | null) => ["brand-kit", ws, "options"] as const,
  preview: (ws: string | null, styleId: string | null, format: string) =>
    ["brand-kit", ws, "preview", styleId, format] as const,
};

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Examples are studied in the background: poll while any is still being read. */
export function useBrandKit(workspaceId: string | null) {
  return useQuery({
    queryKey: brandKitKeys.overview(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 15_000,
    refetchInterval: (query) => {
      const data = query.state.data as BrandKitOverview | undefined;
      if (!data) return false;
      const working = data.assets.some(
        (a) => (a.analysisStatus === "pending" || a.analysisStatus === "running") && !a.stale,
      );
      return working ? 3_000 : false;
    },
    queryFn: () =>
      getBrandKit({ data: { workspaceId: workspaceId as string, includeArchived: true } }),
  });
}

/** Compact list for pickers anywhere in the app. */
export function useStyleOptions(workspaceId: string | null) {
  return useQuery({
    queryKey: brandKitKeys.options(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
    queryFn: () => listStyleOptions({ data: { workspaceId: workspaceId as string } }),
  });
}

export function useStylePromptPreview(
  workspaceId: string | null,
  styleId: string | null,
  format: StyleFormat,
  enabled: boolean,
) {
  return useQuery({
    queryKey: brandKitKeys.preview(workspaceId, styleId, format),
    enabled: Boolean(workspaceId) && enabled,
    staleTime: 10_000,
    queryFn: () =>
      previewStylePrompt({
        data: { workspaceId: workspaceId as string, styleId: styleId ?? "none", format },
      }),
  });
}

function useInvalidate(workspaceId: string | null) {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: brandKitKeys.all(workspaceId) });
    emitAppEvent("brand-kit:changed", { workspaceId });
  };
}

/** Patch the cached overview right away so edits feel instant. */
function usePatchStyleCache(workspaceId: string | null) {
  const client = useQueryClient();
  return (view: BrandStyleView) =>
    client.setQueryData<BrandKitOverview>(brandKitKeys.overview(workspaceId), (old) =>
      old ? { ...old, styles: old.styles.map((s) => (s.id === view.id ? view : s)) } : old,
    );
}

export function useCreateStyle(workspaceId: string | null) {
  const invalidate = useInvalidate(workspaceId);
  return useMutation({
    mutationFn: (input: {
      name: string;
      description?: string | null;
      appliesTo?: StyleFormat[];
      spec?: StyleSpec;
      makeDefault?: boolean;
    }) =>
      createStyle({
        data: { workspaceId: workspaceId as string, ...input, spec: input.spec as never },
      }),
    onSuccess: invalidate,
    onError: (e) => toast.error(message(e, "Couldn't create the style")),
  });
}

export function useUpdateStyle(workspaceId: string | null) {
  const invalidate = useInvalidate(workspaceId);
  const patch = usePatchStyleCache(workspaceId);
  return useMutation({
    mutationFn: (input: {
      styleId: string;
      expectedVersion?: number;
      name?: string;
      description?: string | null;
      appliesTo?: StyleFormat[];
      spec?: StyleSpec;
      coverAssetId?: string | null;
    }) =>
      updateStyle({
        data: { workspaceId: workspaceId as string, ...input, spec: input.spec as never },
      }),
    onSuccess: (view) => {
      patch(view);
      invalidate();
    },
    onError: (e) => {
      toast.error(message(e, "Couldn't save the style"));
      invalidate();
    },
  });
}

export function useStyleActions(workspaceId: string | null) {
  const invalidate = useInvalidate(workspaceId);
  const ws = workspaceId as string;
  const duplicate = useMutation({
    mutationFn: (styleId: string) => duplicateStyle({ data: { workspaceId: ws, styleId } }),
    onSuccess: () => {
      invalidate();
      toast.success("Style copied");
    },
    onError: (e) => toast.error(message(e, "Couldn't copy the style")),
  });
  const archive = useMutation({
    mutationFn: (v: { styleId: string; archived: boolean }) =>
      archiveStyle({ data: { workspaceId: ws, ...v } }),
    onSuccess: (_r, v) => {
      invalidate();
      toast.success(v.archived ? "Style archived" : "Style restored");
    },
    onError: (e) => toast.error(message(e, "Couldn't change the style")),
  });
  const makeDefault = useMutation({
    mutationFn: (styleId: string | null) => setDefaultStyle({ data: { workspaceId: ws, styleId } }),
    onSuccess: (_r, styleId) => {
      invalidate();
      toast.success(styleId ? "Default style set" : "No default style");
    },
    onError: (e) => toast.error(message(e, "Couldn't set the default")),
  });
  // Through the browser's Brand DNA store (never a separate server write), so
  // its next debounced save can't put the old colours back.
  const toDna = useMutation({
    mutationFn: async (style: BrandStyleView) => {
      const spec = parseStyleSpec(style.spec);
      const next: Partial<BrandDna> = {};
      const changed: string[] = [];
      const p = spec.visual?.palette ?? {};
      const roles = (
        [
          ["Primary", p.primary],
          ["Secondary", p.secondary],
          ["Accent", p.accent],
          ["Background", p.background],
          ["Text", p.text],
        ] as const
      ).filter(([, hex]) => hex) as Array<[string, string]>;
      if (roles.length) {
        next.colors = [
          ...roles.map(([name, hex]) => ({ name, hex })),
          ...(p.extra ?? []).map((hex, i) => ({ name: `Extra ${i + 1}`, hex })),
        ];
        changed.push("colors");
      }
      const t = spec.visual?.typography ?? {};
      const fonts = [t.heading, t.body, t.accent].filter(
        (f, i, all): f is string => !!f && all.indexOf(f) === i,
      );
      if (fonts.length) {
        next.fonts = fonts.slice(0, 3);
        changed.push("fonts");
      }
      if (spec.writing?.voice && spec.writing.voice !== readBrandDnaFor(ws).voice) {
        next.voice = spec.writing.voice;
        changed.push("voice");
      }
      if (changed.length) saveBrandDnaFor(ws, next);
      return { changed };
    },
    onSuccess: (r) => {
      invalidate();
      toast.success(
        r.changed.length ? `Brand DNA updated: ${r.changed.join(", ")}` : "Nothing to copy yet",
      );
    },
    onError: (e) => toast.error(message(e, "Couldn't update Brand DNA")),
  });
  return { duplicate, archive, makeDefault, toDna };
}

export function useUploadKitFiles(workspaceId: string | null) {
  const invalidate = useInvalidate(workspaceId);
  return useMutation({
    mutationFn: async (input: {
      kind: Exclude<KitAssetKind, "writing_sample">;
      files: File[];
      styleId?: string | null;
    }) => {
      const ids: string[] = [];
      const failed: string[] = [];
      // One at a time: keeps memory low for big videos and order stable.
      for (const file of input.files) {
        try {
          const r = await uploadKitFile({
            workspaceId: workspaceId as string,
            kind: input.kind,
            file,
            styleId: input.styleId,
          });
          ids.push(r.assetId);
        } catch (e) {
          failed.push(`${file.name}: ${message(e, "upload failed")}`);
        }
        invalidate();
      }
      return { ids, failed };
    },
    onSuccess: (r) => {
      if (r.failed.length) toast.error(r.failed.slice(0, 3).join("\n"));
      else if (r.ids.length)
        toast.success(r.ids.length === 1 ? "Added to your kit" : `${r.ids.length} files added`);
    },
    onError: (e) => toast.error(message(e, "Upload failed")),
  });
}

export function useAddWritingSample(workspaceId: string | null) {
  const invalidate = useInvalidate(workspaceId);
  return useMutation({
    mutationFn: (input: {
      text?: string;
      url?: string;
      label?: string | null;
      styleId?: string | null;
    }) => addWritingSample({ data: { workspaceId: workspaceId as string, ...input } }),
    onSuccess: () => {
      invalidate();
      toast.success("Sample added — reading its style");
    },
    onError: (e) => toast.error(message(e, "Couldn't add the sample")),
  });
}

export function useKitAssetActions(workspaceId: string | null) {
  const invalidate = useInvalidate(workspaceId);
  const ws = workspaceId as string;
  const remove = useMutation({
    mutationFn: (assetId: string) => deleteKitAsset({ data: { workspaceId: ws, assetId } }),
    onSuccess: () => {
      invalidate();
      toast.success("Removed");
    },
    onError: (e) => toast.error(message(e, "Couldn't remove it")),
  });
  const update = useMutation({
    mutationFn: (v: {
      assetId: string;
      label?: string | null;
      tags?: string[];
      styleId?: string | null;
    }) => updateKitAsset({ data: { workspaceId: ws, ...v } }),
    onSuccess: invalidate,
    onError: (e) => toast.error(message(e, "Couldn't save")),
  });
  const reanalyze = useMutation({
    mutationFn: (assetIds: string[]) => analyzeKitAssets({ data: { workspaceId: ws, assetIds } }),
    onSuccess: invalidate,
    onError: (e) => toast.error(message(e, "Couldn't start")),
  });
  return { remove, update, reanalyze };
}

export function useSuggestStyle(workspaceId: string | null) {
  return useMutation({
    mutationFn: (assetIds: string[]) =>
      suggestStyle({ data: { workspaceId: workspaceId as string, assetIds } }),
    onError: (e) => toast.error(message(e, "Couldn't read a style from these")),
  });
}

export function useDescribeStyle(workspaceId: string | null) {
  return useMutation({
    mutationFn: (description: string) =>
      describeStyle({ data: { workspaceId: workspaceId as string, description } }),
    onError: (e) => toast.error(message(e, "Couldn't turn that into a style")),
  });
}
