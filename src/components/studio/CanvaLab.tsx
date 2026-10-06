"use client";
import { useEffect, useState } from "react";
import { Maximize2 } from "lucide-react";
import { Copy, Download, Pencil, RefreshCw } from "@/components/icons";
import { CanvaPanel, type CanvaPanelProps } from "./CanvaPanel";

type Scene = Pick<
  CanvaPanelProps,
  "mode" | "slideCount" | "hasDesign" | "usingCanva" | "opened" | "busy" | "error"
>;

const BASE: Scene = {
  mode: null,
  slideCount: 0,
  hasDesign: false,
  usingCanva: false,
  opened: null,
  busy: null,
  error: null,
};
const LINK = "https://www.canva.com/";
const editable = { ...BASE, mode: "magic_layers" as const, slideCount: 1, hasDesign: true };

const SCENES: Record<string, Scene> = {
  new: BASE,
  preparing: { ...BASE, busy: "open" },
  ready: { ...editable, opened: { editUrl: LINK, slides: [] } },
  slides: {
    ...editable,
    slideCount: 6,
    opened: {
      editUrl: LINK,
      slides: [1, 2, 3, 4, 5, 6].map((page) => ({ page, editUrl: LINK })),
    },
  },
  edited: editable,
  returning: { ...editable, busy: "back" },
  using: { ...editable, usingCanva: true },
  flat: { ...BASE, mode: "flat_image", slideCount: 1, hasDesign: true },
  error: {
    ...editable,
    slideCount: 6,
    error:
      "The Canva design has 5 pages and this post has 6. Make them match in Canva, then bring it back again.",
  },
};

const ICON =
  "grid size-8 place-items-center rounded-full text-foreground/80 hover:bg-surface-2 [&_svg]:size-3.5";
const TOOL =
  "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-foreground hover:bg-surface-2 [&_svg]:size-3.5";

export function CanvaLab() {
  const [scene, setScene] = useState("new");
  const [place, setPlace] = useState<"tool" | "button">("tool");
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("scene");
    if (wanted && wanted in SCENES) setScene(wanted);
    if (params.get("place") === "button") setPlace("button");
    setOpen(true);
    setReady(true);
  }, []);

  const noop = () => {};
  const panel = (
    <CanvaPanel
      variant={place}
      open={open}
      onOpenChange={setOpen}
      {...SCENES[scene]}
      onOpen={noop}
      onBringBack={noop}
      onUseOriginal={noop}
    />
  );

  return (
    <main
      data-testid="canva-lab-frame"
      data-ready={ready}
      className="min-h-screen bg-background p-4 text-foreground sm:p-8"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex flex-wrap gap-1.5">
          {Object.keys(SCENES).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => {
                setScene(name);
                setOpen(true);
              }}
              className={`h-8 rounded-full border px-3 text-xs ${name === scene ? "border-primary text-foreground" : "border-border text-muted-foreground"}`}
            >
              {name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPlace(place === "tool" ? "button" : "tool")}
            className="h-8 rounded-full border border-border px-3 text-xs text-muted-foreground"
          >
            in: {place === "tool" ? "Studio toolbar" : "Library"}
          </button>
        </div>

        {place === "tool" ? (
          <div className="relative h-[30rem] rounded-3xl border border-border bg-surface-1">
            <div className="absolute inset-x-3 top-3 flex items-center">
              <div className="ml-auto flex items-center rounded-full bg-surface-3/90 p-1 shadow-2 ring-1 ring-border/70 backdrop-blur">
                <button type="button" className={TOOL}>
                  <Pencil />
                  Edit
                </button>
                <button type="button" className={TOOL}>
                  <RefreshCw />
                  <span className="hidden sm:inline">New take</span>
                </button>
                <span aria-hidden className="mx-1 h-4 w-px bg-border" />
                <button type="button" className={ICON} aria-label="Copy text">
                  <Copy />
                </button>
                <button type="button" className={ICON} aria-label="Download">
                  <Download />
                </button>
                <button type="button" className={ICON} aria-label="Open full size">
                  <Maximize2 />
                </button>
                {panel}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-[30rem] flex-wrap content-start justify-end gap-2 rounded-3xl border border-border bg-surface-1 p-4">
            {panel}
          </div>
        )}
      </div>
    </main>
  );
}
