"use client";

import { useState } from "react";
import { toast } from "@/lib/toast";
import { CalendarDays, Copy, Download, FileSpreadsheet, FileText } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { dsGhostBtn } from "@/components/app/surface/buttons";
import { cn } from "@/lib/utils";
import {
  calendarCsv,
  calendarIcs,
  calendarPrintHtml,
  calendarText,
  exportFileName,
} from "@/lib/calendar/export";
import type { CalendarEntry } from "@/lib/calendar/model";

// A byte-order mark: with it, Excel reads accents and emoji correctly.
const BOM = String.fromCharCode(0xfeff);

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before freeing the blob.
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Print through a hidden frame, so no pop-up window is ever opened. */
function printHtml(markup: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  frame.srcdoc = markup;
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) return frame.remove();
    win.onafterprint = () => frame.remove();
    win.focus();
    win.print();
    // Some browsers never fire `afterprint`; clean up regardless.
    window.setTimeout(() => frame.remove(), 60_000);
  };
  document.body.appendChild(frame);
}

export function ExportMenu({
  shown,
  all,
  shownLabel,
  shownSlug,
}: {
  /** The posts on screen: the visible dates, with the current filters. */
  shown: CalendarEntry[];
  /** Every post in the calendar. */
  all: CalendarEntry[];
  /** "October 2026" — names the visible dates in the menu and on the printout. */
  shownLabel: string;
  shownSlug: string;
}) {
  const [range, setRange] = useState<"shown" | "all">("shown");
  const entries = range === "shown" ? shown : all;
  const label = range === "shown" ? shownLabel : "All posts";
  const slug = range === "shown" ? shownSlug : "all";

  const run = (action: (list: CalendarEntry[]) => void | Promise<void>) => () => {
    if (!entries.length) {
      toast("No posts to export", {
        description: range === "shown" ? "Try exporting all posts instead." : undefined,
      });
      return;
    }
    void action(entries);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn(dsGhostBtn, "h-8 px-3 text-[12.5px]")}>
          <Download className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Export</span>
          <span className="sr-only sm:hidden">Export</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>What to export</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={range}
          onValueChange={(value) => setRange(value === "all" ? "all" : "shown")}
        >
          <DropdownMenuRadioItem value="shown" onSelect={(e) => e.preventDefault()}>
            {shownLabel} · {shown.length}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="all" onSelect={(e) => e.preventDefault()}>
            All posts · {all.length}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={run((list) => {
            download(
              exportFileName("", slug, "csv"),
              BOM + calendarCsv(list),
              "text/csv;charset=utf-8",
            );
            toast.success("Spreadsheet downloaded");
          })}
        >
          <FileSpreadsheet className="h-4 w-4" />
          Spreadsheet (Excel, Sheets)
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={run((list) => {
            download(
              exportFileName("", slug, "ics"),
              calendarIcs(list, { name: "Content calendar" }),
              "text/calendar;charset=utf-8",
            );
            toast.success("Calendar file downloaded", {
              description: "Open it to add the posts to Google, Outlook or Apple Calendar.",
            });
          })}
        >
          <CalendarDays className="h-4 w-4" />
          Calendar file (Google, Outlook)
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={run((list) =>
            printHtml(
              calendarPrintHtml(list, {
                title: "Content calendar",
                subtitle: `${label} · ${list.length} ${list.length === 1 ? "post" : "posts"}`,
              }),
            ),
          )}
        >
          <FileText className="h-4 w-4" />
          Print or save as PDF
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={run(async (list) => {
            try {
              await navigator.clipboard.writeText(calendarText(list));
              toast.success("Copied");
            } catch {
              toast.error("Couldn't copy. Try the spreadsheet instead.");
            }
          })}
        >
          <Copy className="h-4 w-4" />
          Copy as text
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
