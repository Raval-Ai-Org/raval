import { jsPDF } from "jspdf";
import type { CoachBriefing } from "@/lib/coach.functions";

function fmtDate(iso?: string) {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function safeFilename(s: string) {
  return s.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "briefing";
}

export function exportBriefingPDF(b: CoachBriefing, workspaceLabel?: string) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 54;
  const maxW = pageW - margin * 2;
  let y = margin;

  const ensure = (needed = 60) => {
    if (y + needed > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const text = (str: string, size = 11, style: "normal" | "bold" = "normal", color: [number, number, number] = [30, 30, 30]) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(str, maxW);
    for (const line of lines) {
      ensure(size + 4);
      doc.text(line, margin, y);
      y += size + 4;
    }
  };

  const rule = () => {
    ensure(20);
    doc.setDrawColor(220);
    doc.setLineWidth(0.5);
    doc.line(margin, y, pageW - margin, y);
    y += 14;
  };

  const heading = (str: string) => {
    ensure(28);
    y += 8;
    text(str.toUpperCase(), 10, "bold", [110, 110, 110]);
    rule();
  };

  // Header
  text("Raval AI · Weekly Marketing Coach", 9, "bold", [130, 130, 130]);
  y += 4;
  text(b.headline || "Weekly Briefing", 20, "bold", [15, 15, 15]);
  text(`${workspaceLabel ? workspaceLabel + " · " : ""}${fmtDate(b.generatedAt)}`, 10, "normal", [120, 120, 120]);
  y += 6;
  rule();

  // Focus
  if (b.focus?.title) {
    heading("Today's focus");
    text(b.focus.title, 13, "bold");
    if (b.focus.why) text(b.focus.why, 11);
    if (b.focus.action?.label) text(`Next step → ${b.focus.action.label}`, 10, "bold", [80, 80, 80]);
  }

  const section = (title: string, items: { title: string; detail?: string; action?: { label?: string } }[]) => {
    if (!items?.length) return;
    heading(title);
    items.forEach((it, i) => {
      text(`${i + 1}. ${it.title}`, 12, "bold");
      if (it.detail) text(it.detail, 11);
      if (it.action?.label) text(`   → ${it.action.label}`, 10, "normal", [90, 90, 90]);
      y += 4;
    });
  };

  section("Wins", b.wins);
  section("Risks", b.risks);
  section("Competitors", b.competitors);
  section("Market signals", b.market);
  section("Recommended plays", b.plays);

  // Week plan / next steps
  if (b.weekPlan?.length) {
    heading("Next steps · this week");
    b.weekPlan.forEach((s, i) => text(`${i + 1}. ${s}`, 11));
  }

  // Sources
  if (b.sources?.length) {
    heading("Citations");
    b.sources.forEach((s, i) => {
      text(`[${i + 1}] ${s.label}`, 10, "bold");
      text(s.url, 9, "normal", [60, 90, 200]);
      y += 2;
    });
  }

  // Footer on each page
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Raval AI · Marketing Intelligence Layer`, margin, pageH - 24);
    doc.text(`${p} / ${pageCount}`, pageW - margin, pageH - 24, { align: "right" });
  }

  doc.save(`${safeFilename((workspaceLabel || "raval") + "-weekly-briefing")}.pdf`);
}

export function exportBriefingDoc(b: CoachBriefing, workspaceLabel?: string) {
  const esc = (s = "") =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const section = (title: string, items: { title: string; detail?: string; action?: { label?: string } }[]) => {
    if (!items?.length) return "";
    return `<h2>${esc(title)}</h2><ol>${items
      .map(
        (it) =>
          `<li><strong>${esc(it.title)}</strong>${it.detail ? `<br/><span>${esc(it.detail)}</span>` : ""}${
            it.action?.label ? `<br/><em>Next step → ${esc(it.action.label)}</em>` : ""
          }</li>`,
      )
      .join("")}</ol>`;
  };

  const html = `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>Weekly Marketing Briefing</title>
<style>
  body { font-family: Calibri, Arial, sans-serif; color:#1a1a1a; font-size:11pt; }
  h1 { font-size: 22pt; margin: 0 0 4pt; }
  h2 { font-size: 12pt; text-transform: uppercase; letter-spacing:.08em; color:#666; border-bottom:1px solid #ddd; padding-bottom:4pt; margin-top:20pt; }
  .meta { color:#777; font-size:10pt; margin-bottom: 14pt; }
  ol, ul { padding-left: 20pt; }
  li { margin-bottom: 8pt; }
  a { color:#2a5db0; }
  .focus { background:#f7f8fb; padding:12pt; border-left:3pt solid #333; margin: 8pt 0 12pt; }
</style></head>
<body>
  <div style="color:#888;font-size:9pt;letter-spacing:.1em;text-transform:uppercase;">Raval AI · Weekly Marketing Coach</div>
  <h1>${esc(b.headline || "Weekly Briefing")}</h1>
  <div class="meta">${esc(workspaceLabel ? workspaceLabel + " · " : "")}${esc(fmtDate(b.generatedAt))}</div>
  ${
    b.focus?.title
      ? `<div class="focus"><div style="font-size:9pt;text-transform:uppercase;letter-spacing:.08em;color:#666;">Today's focus</div>
         <div style="font-size:14pt;font-weight:bold;margin:4pt 0;">${esc(b.focus.title)}</div>
         ${b.focus.why ? `<div>${esc(b.focus.why)}</div>` : ""}
         ${b.focus.action?.label ? `<div style="margin-top:6pt;"><strong>Next step →</strong> ${esc(b.focus.action.label)}</div>` : ""}
        </div>`
      : ""
  }
  ${section("Wins", b.wins)}
  ${section("Risks", b.risks)}
  ${section("Competitors", b.competitors)}
  ${section("Market signals", b.market)}
  ${section("Recommended plays", b.plays)}
  ${
    b.weekPlan?.length
      ? `<h2>Next steps · this week</h2><ol>${b.weekPlan.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`
      : ""
  }
  ${
    b.sources?.length
      ? `<h2>Citations</h2><ol>${b.sources
          .map((s) => `<li><strong>${esc(s.label)}</strong><br/><a href="${esc(s.url)}">${esc(s.url)}</a></li>`)
          .join("")}</ol>`
      : ""
  }
  <p style="margin-top:24pt;color:#999;font-size:9pt;">Raval AI · Marketing Intelligence Layer</p>
</body></html>`;

  const blob = new Blob(["\ufeff", html], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFilename((workspaceLabel || "raval") + "-weekly-briefing")}.doc`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
