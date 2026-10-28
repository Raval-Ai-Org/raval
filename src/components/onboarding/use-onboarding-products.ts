"use client";

// The product catalogue while a person sets it up in onboarding: the stored
// rows, what discovery found that they haven't kept or dropped, and each
// card's busy state. All writes go through src/server/fns/products.ts and
// POST /api/products/photos; this only keeps the screen in step with them.
import { useCallback, useEffect, useState } from "react";
import { authedFetch } from "@/lib/authed-fetch";
import {
  archiveProduct,
  importProducts,
  listProducts,
  saveProduct,
  updateProductPhotos,
} from "@/lib/products.functions";
import { productFingerprint, type Product, type ProductCandidate } from "@/lib/products/catalog";
import type { ProductDraft } from "./ProductCard";

const message = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

export function useOnboardingProducts(workspaceId: string | null) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [lowResolution, setLowResolution] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [candidatesDismissed, setCandidatesDismissed] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    let live = true;
    setLoading(true);
    listProducts({ data: { workspaceId } })
      .then((rows) => live && setProducts(rows))
      .catch(() => undefined)
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [workspaceId]);

  const replace = useCallback(
    (next: Product) => setProducts((list) => list.map((p) => (p.id === next.id ? next : p))),
    [],
  );
  const mark = (id: string, on: boolean) => setBusy((b) => ({ ...b, [id]: on }));

  /** Discovery results not yet in the catalogue. */
  const pending = useCallback(
    (candidates: ProductCandidate[]) => {
      const kept = new Set(products.map((p) => productFingerprint({ url: p.url, name: p.name })));
      const names = new Set(products.map((p) => p.name.toLowerCase()));
      return candidates.filter((c) => !kept.has(c.fingerprint) && !names.has(c.name.toLowerCase()));
    },
    [products],
  );

  const run = async <T>(fn: () => Promise<T>, fallback: string): Promise<T | null> => {
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(message(e, fallback));
      return null;
    }
  };

  return {
    products,
    loading,
    importing,
    adding,
    busy,
    lowResolution,
    error,
    candidatesDismissed,
    pending,
    dismissCandidates: () => setCandidatesDismissed(true),

    async importCandidates(candidates: ProductCandidate[]) {
      if (!workspaceId || !candidates.length) return;
      setImporting(true);
      const rows = await run(
        () => importProducts({ data: { workspaceId, candidates } }),
        "Couldn't keep those products. Try again.",
      );
      if (rows) {
        setProducts(rows);
        setCandidatesDismissed(true);
      }
      setImporting(false);
    },

    async add(draft: ProductDraft) {
      if (!workspaceId) return;
      setAdding(true);
      const row = await run(
        () => saveProduct({ data: { workspaceId, product: draft } }),
        "Couldn't add that. Try again.",
      );
      if (row) setProducts((list) => [...list.filter((p) => p.id !== row.id), row]);
      setAdding(false);
    },

    async save(id: string, draft: ProductDraft) {
      if (!workspaceId) return;
      mark(id, true);
      const row = await run(
        () => saveProduct({ data: { workspaceId, id, product: draft } }),
        "Couldn't save your changes. Try again.",
      );
      if (row) replace(row);
      mark(id, false);
    },

    async archive(id: string) {
      if (!workspaceId) return;
      const before = products;
      setProducts((list) => list.filter((p) => p.id !== id));
      const ok = await run(
        () => archiveProduct({ data: { workspaceId, id } }),
        "Couldn't remove that. Try again.",
      );
      if (!ok) setProducts(before);
    },

    async upload(id: string, file: File) {
      if (!workspaceId) return;
      mark(id, true);
      const out = await run(async () => {
        const form = new FormData();
        form.append("file", file);
        const q = new URLSearchParams({ workspaceId, productId: id });
        const res = await authedFetch(`/api/products/photos?${q}`, {
          method: "POST",
          body: form,
          workspaceId,
        });
        const json = (await res.json().catch(() => ({}))) as {
          product?: Product;
          lowResolution?: boolean;
          error?: string;
        };
        if (!res.ok || !json.product)
          throw new Error(json.error || "That photo couldn't be saved.");
        return json as { product: Product; lowResolution: boolean };
      }, "That photo couldn't be saved.");
      if (out) {
        replace(out.product);
        setLowResolution((m) => ({ ...m, [id]: out.lowResolution }));
      }
      mark(id, false);
    },

    async setPrimary(id: string, assetId: string) {
      if (!workspaceId) return;
      mark(id, true);
      const row = await run(
        () => updateProductPhotos({ data: { workspaceId, id, primary: assetId } }),
        "Couldn't change the photo.",
      );
      if (row) replace(row);
      mark(id, false);
    },
  };
}
