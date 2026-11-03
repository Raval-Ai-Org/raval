"use client";

// The product catalogue while a person sets it up in onboarding: the stored
// rows, what discovery found and is being kept right now, and each card's busy
// state. All writes go through src/server/fns/products.ts and
// POST /api/products/photos; this only keeps the screen in step with them.
//
// What the scan finds is kept by itself (`autoKeep`), a few at a time, while
// the person is still answering the goal questions; they remove what they
// don't want. Each item is sent once per visit, and the server never brings
// back one a person removed.
import { useCallback, useEffect, useRef, useState } from "react";
import { authedFetch } from "@/lib/authed-fetch";
import {
  archiveProduct,
  importProducts,
  listProducts,
  saveProduct,
  updateProductPhotos,
} from "@/lib/products.functions";
import {
  nameKey,
  productFingerprint,
  type Product,
  type ProductCandidate,
} from "@/lib/products/catalog";
import type { ProductDraft } from "./ProductCard";

const message = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

/** Small batches, so the first cards appear within seconds. */
const BATCH = 6;

/** What makes two found items the same one: the page, or the name. */
const keys = (c: Pick<ProductCandidate, "fingerprint" | "name">) => [
  c.fingerprint,
  `name:${nameKey(c.name)}`,
];

export function useOnboardingProducts(workspaceId: string | null) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [lowResolution, setLowResolution] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [candidatesDismissed, setCandidatesDismissed] = useState(false);
  /** Found on the site and being saved now (or waiting their turn). */
  const [incoming, setIncoming] = useState<ProductCandidate[]>([]);
  /** Found, but saving failed; "Try again" sends them once more. */
  const [failed, setFailed] = useState<ProductCandidate[]>([]);
  /** How many things the scan kept by itself during this visit. */
  const [autoKept, setAutoKept] = useState(0);
  const sent = useRef(new Set<string>());
  const chain = useRef<Promise<void>>(Promise.resolve());
  const productsRef = useRef<Product[]>([]);
  productsRef.current = products;

  useEffect(() => {
    if (!workspaceId) return;
    let live = true;
    setLoading(true);
    sent.current = new Set();
    listProducts({ data: { workspaceId } })
      .then((rows) => live && setProducts(rows))
      .catch(() => undefined)
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [workspaceId]);

  /** Save found items in small batches, one batch after another. */
  const keepInBatches = useCallback(
    (list: ProductCandidate[]) => {
      if (!workspaceId || !list.length) return;
      for (const c of list) keys(c).forEach((k) => sent.current.add(k));
      setIncoming((now) => [...now, ...list]);
      setFailed((now) => now.filter((f) => !list.some((c) => c.fingerprint === f.fingerprint)));
      for (let i = 0; i < list.length; i += BATCH) {
        const batch = list.slice(i, i + BATCH);
        chain.current = chain.current.then(async () => {
          setImporting(true);
          try {
            const before = productsRef.current.length;
            const rows = await importProducts({ data: { workspaceId, candidates: batch } });
            setProducts(rows);
            setAutoKept((n) => n + Math.max(0, rows.length - before));
          } catch {
            setFailed((now) => [...now, ...batch]);
          } finally {
            const done = new Set(batch.map((c) => c.fingerprint));
            setIncoming((now) => now.filter((c) => !done.has(c.fingerprint)));
            setImporting(false);
          }
        });
      }
    },
    [workspaceId],
  );

  const replace = useCallback(
    (next: Product) => setProducts((list) => list.map((p) => (p.id === next.id ? next : p))),
    [],
  );
  const mark = (id: string, on: boolean) => setBusy((b) => ({ ...b, [id]: on }));

  /** Discovery results not yet in the catalogue and not already sent. */
  const pending = useCallback(
    (candidates: ProductCandidate[]) => {
      const kept = new Set(products.map((p) => productFingerprint({ url: p.url, name: p.name })));
      const names = new Set(products.map((p) => nameKey(p.name)));
      return candidates.filter(
        (c) =>
          !kept.has(c.fingerprint) &&
          !names.has(nameKey(c.name)) &&
          !keys(c).some((k) => sent.current.has(k)),
      );
    },
    [products],
  );

  /** Keep what the scan found, by itself. Safe to call on every new discovery. */
  const autoKeep = useCallback(
    (candidates: ProductCandidate[]) => {
      if (loading || candidatesDismissed) return;
      keepInBatches(pending(candidates));
    },
    [loading, candidatesDismissed, keepInBatches, pending],
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
    incoming,
    failed,
    autoKept,
    pending,
    autoKeep,
    dismissCandidates: () => setCandidatesDismissed(true),
    retryFailed: () => keepInBatches(failed),

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

    /** Remove everything the scan kept by itself in this visit. */
    async removeFound() {
      if (!workspaceId) return;
      const found = products.filter((p) => p.source !== "manual");
      setProducts((list) => list.filter((p) => p.source === "manual"));
      const results = await Promise.allSettled(
        found.map((p) => archiveProduct({ data: { workspaceId, id: p.id } })),
      );
      if (results.some((r) => r.status === "rejected")) {
        setError("Couldn't remove some of them. Try again.");
        listProducts({ data: { workspaceId } })
          .then(setProducts)
          .catch(() => undefined);
      }
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
