"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search as SearchIcon,
  X as XIcon,
  Download,
  Trash2,
  Copy,
  Image as ImageIcon,
  Layers,
} from "@/components/ui/gemini-icons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  listAllCachedImages,
  removeCachedImage,
  SIZE_LABEL,
  type CachedImageEntry,
  type ImgSize,
} from "@/lib/post-image";

export type ImageLibraryItemMeta = {
  postId: string;
  title?: string;
  clientName?: string;
  channel?: string | null;
};

export function ImageLibraryModal({
  open,
  onClose,
  metaByPostId,
}: {
  open: boolean;
  onClose: () => void;
  metaByPostId: Record<string, ImageLibraryItemMeta>;
}) {
  const [entries, setEntries] = useState<CachedImageEntry[]>([]);
  const [q, setQ] = useState("");
  const [sizeFilter, setSizeFilter] = useState<"all" | ImgSize>("all");
  const [selected, setSelected] = useState<CachedImageEntry | null>(null);

  const refresh = () => setEntries(listAllCachedImages());

  useEffect(() => {
    if (!open) return;
    refresh();
    setQ("");
    setSizeFilter("all");
    setSelected(null);
    const on = () => refresh();
    window.addEventListener("post-image:cached", on as EventListener);
    return () => window.removeEventListener("post-image:cached", on as EventListener);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selected) setSelected(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, selected, onClose]);

  const filtered = useMemo(() => {
    const norm = q.trim().toLowerCase();
    return entries
      .filter((e) => sizeFilter === "all" || e.size === sizeFilter)
      .filter((e) => {
        if (!norm) return true;
        const m = metaByPostId[e.postId];
        return (
          (m?.title || "").toLowerCase().includes(norm) ||
          (m?.clientName || "").toLowerCase().includes(norm) ||
          (m?.channel || "").toLowerCase().includes(norm) ||
          e.postId.toLowerCase().includes(norm)
        );
      })
      .reverse(); // newest-ish first (cache is append-order)
  }, [entries, q, sizeFilter, metaByPostId]);

  const sizeCounts = useMemo(() => {
    const c: Record<string, number> = { all: entries.length };
    for (const e of entries) c[e.size] = (c[e.size] ?? 0) + 1;
    return c;
  }, [entries]);

  async function downloadOne(e: CachedImageEntry) {
    try {
      const a = document.createElement("a");
      a.href = e.dataUrl;
      const meta = metaByPostId[e.postId];
      const safe = (meta?.title || meta?.clientName || e.postId)
        .replace(/[^a-z0-9-_]+/gi, "-")
        .slice(0, 60);
      a.download = `${safe}-${e.size}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      toast.error("Download failed");
    }
  }

  async function copyOne(e: CachedImageEntry) {
    try {
      const blob = await (await fetch(e.dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Clipboard not available");
    }
  }

  function deleteOne(e: CachedImageEntry) {
    removeCachedImage(e.postId, e.size);
    setSelected((s) => (s && s.postId === e.postId && s.size === e.size ? null : s));
    refresh();
    toast("Removed from library");
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="relative flex h-[85vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#0d0d0d]/95 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-white/5 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-aura/10 text-aura ring-1 ring-aura/20">
              <ImageIcon className="h-4 w-4" />
            </span>
            <div>
              <h2 className="font-display text-[18px] leading-tight tracking-tight text-foreground">
                Image library
              </h2>
              <p className="text-[11.5px] text-muted-foreground">
                {entries.length} generated {entries.length === 1 ? "image" : "images"} across every
                client
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/5 text-muted-foreground transition hover:border-white/20 hover:text-foreground"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-white/5 px-5 py-3">
          <div className="relative flex-1 min-w-[220px]">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by post title, client, or channel…"
              className="h-9 w-full rounded-full border border-white/10 bg-white/5 pl-9 pr-3 text-[12.5px] text-foreground placeholder:text-muted-foreground/70 focus:border-white/20 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <SizeChip
              label="All"
              count={sizeCounts.all ?? 0}
              active={sizeFilter === "all"}
              onClick={() => setSizeFilter("all")}
            />
            {(["1024x1024", "1792x1024", "1024x1792"] as ImgSize[]).map((s) =>
              (sizeCounts[s] ?? 0) > 0 ? (
                <SizeChip
                  key={s}
                  label={SIZE_LABEL[s]}
                  count={sizeCounts[s] ?? 0}
                  active={sizeFilter === s}
                  onClick={() => setSizeFilter(s)}
                />
              ) : null,
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {filtered.length === 0 ? (
            <EmptyState
              hasAny={entries.length > 0}
              onClear={() => {
                setQ("");
                setSizeFilter("all");
              }}
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              <AnimatePresence mode="popLayout">
                {filtered.map((e) => {
                  const meta = metaByPostId[e.postId];
                  return (
                    <motion.button
                      key={`${e.postId}::${e.size}`}
                      layout
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.94 }}
                      transition={{ duration: 0.18 }}
                      onClick={() => setSelected(e)}
                      className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02] text-left transition hover:border-white/15 hover:bg-white/[0.04]"
                    >
                      <div className="relative aspect-square w-full overflow-hidden bg-black/40">
                        <img
                          src={e.dataUrl}
                          alt={meta?.title || "Generated post image"}
                          loading="lazy"
                          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                        />
                        <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white/85 backdrop-blur">
                          {SIZE_LABEL[e.size]}
                        </span>
                      </div>
                      <div className="min-w-0 px-3 py-2.5">
                        <div className="truncate text-[12.5px] font-medium text-foreground">
                          {meta?.title || "Untitled post"}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 truncate text-[10.5px] text-muted-foreground">
                          {meta?.clientName ? (
                            <span className="truncate">{meta.clientName}</span>
                          ) : (
                            <span>Unlinked</span>
                          )}
                          {meta?.channel && <span className="opacity-60">· {meta.channel}</span>}
                        </div>
                      </div>
                    </motion.button>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/5 px-5 py-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Layers className="h-3 w-3" /> Cached locally on this device
          </span>
          <span>Press Esc to close</span>
        </div>

        {/* Detail overlay */}
        <AnimatePresence>
          {selected && (
            <motion.div
              key="detail"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
              onClick={() => setSelected(null)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                onClick={(ev) => ev.stopPropagation()}
                className="grid w-full max-w-4xl grid-cols-1 gap-5 overflow-hidden rounded-2xl border border-white/10 bg-[#0d0d0d] p-5 md:grid-cols-[1.4fr_1fr]"
              >
                <div className="overflow-hidden rounded-xl bg-black/50">
                  <img
                    src={selected.dataUrl}
                    alt=""
                    className="h-full max-h-[70vh] w-full object-contain"
                  />
                </div>
                <div className="flex min-w-0 flex-col">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-display text-[18px] leading-tight text-foreground">
                        {metaByPostId[selected.postId]?.title || "Generated image"}
                      </div>
                      <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                        {metaByPostId[selected.postId]?.clientName || "Unlinked"}
                        {metaByPostId[selected.postId]?.channel && (
                          <> · {metaByPostId[selected.postId]?.channel}</>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => setSelected(null)}
                      aria-label="Close preview"
                      className="grid h-8 w-8 place-items-center rounded-full border border-white/10 bg-white/5 text-muted-foreground hover:text-foreground"
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <dl className="mb-4 grid grid-cols-2 gap-2 text-[11.5px]">
                    <MetaCell label="Size" value={SIZE_LABEL[selected.size]} />
                    <MetaCell label="Format" value="PNG" />
                    <MetaCell label="Post ID" value={selected.postId.slice(0, 8) + "…"} />
                    <MetaCell label="Source" value="AI generated" />
                  </dl>
                  <div className="mt-auto grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <ActionButton
                      icon={<Download className="h-3.5 w-3.5" />}
                      label="Download"
                      onClick={() => downloadOne(selected)}
                    />
                    <ActionButton
                      icon={<Copy className="h-3.5 w-3.5" />}
                      label="Copy"
                      onClick={() => copyOne(selected)}
                    />
                    <ActionButton
                      icon={<Trash2 className="h-3.5 w-3.5" />}
                      label="Remove"
                      tone="danger"
                      onClick={() => deleteOne(selected)}
                    />
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function SizeChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition",
        active
          ? "border-white/25 bg-white text-black"
          : "border-white/10 bg-white/5 text-muted-foreground hover:border-white/20 hover:text-foreground",
      )}
    >
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 text-[10px] tabular-nums",
          active ? "bg-black/10" : "bg-white/5",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-2">
      <div className="text-[9.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 truncate text-[12px] text-foreground">{value}</div>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: "danger";
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition",
        tone === "danger"
          ? "border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20"
          : "border-white/10 bg-white/5 text-foreground hover:border-white/20 hover:bg-white/10",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function EmptyState({ hasAny, onClear }: { hasAny: boolean; onClear: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center py-16 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/5 text-muted-foreground ring-1 ring-white/10">
        <ImageIcon className="h-6 w-6" />
      </span>
      <h3 className="mt-4 font-display text-[17px] text-foreground">
        {hasAny ? "No matches" : "No generated images yet"}
      </h3>
      <p className="mt-1 max-w-sm text-[12.5px] text-muted-foreground">
        {hasAny
          ? "Try a different search or clear the filters."
          : "Generate an image on any post — it'll appear here for every client, in one place."}
      </p>
      {hasAny && (
        <button
          onClick={onClear}
          className="mt-4 inline-flex h-8 items-center rounded-full border border-white/10 bg-white/5 px-3 text-[11.5px] font-medium text-foreground hover:bg-white/10"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
