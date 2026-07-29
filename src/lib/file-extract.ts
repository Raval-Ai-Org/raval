// Extracts text/data from attached files for the chat composer.
// Handles: text/code, PDF, DOCX, XLSX/XLS/CSV, and images (via server vision).
import { authedFetch } from "./authed-fetch";

export type AttachmentKind = "text" | "pdf" | "docx" | "xlsx" | "image" | "other";

export type Attachment = {
  id: string;
  file: File;
  name: string;
  size: number;
  mime: string;
  kind: AttachmentKind;
  status: "reading" | "ready" | "error";
  text?: string;
  preview?: string; // data URL for images
  error?: string;
};

export const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB
export const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
export const MAX_TEXT_CHARS = 60_000; // per file, keeps prompt sane

const TEXT_EXT = new Set([
  "txt","md","markdown","csv","tsv","json","jsonl","ndjson","log","yml","yaml","toml","ini","env",
  "html","htm","xml","svg","css","scss","less","js","jsx","ts","tsx","mjs","cjs","py","rb","go",
  "rs","java","kt","kts","swift","c","h","cc","cpp","hpp","cs","php","sh","bash","zsh","fish",
  "sql","graphql","gql","proto","dockerfile","gitignore","gitattributes","prettierrc","eslintrc",
  "vue","svelte","astro","liquid","hbs","handlebars","mdx","rst","tex","srt","vtt","conf",
]);

export function classify(file: File): AttachmentKind {
  const mime = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop()! : "";
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime.includes("wordprocessingml") || ext === "docx") return "docx";
  if (
    mime.includes("spreadsheetml") ||
    mime === "application/vnd.ms-excel" ||
    ["xlsx","xls","xlsm","xlsb","ods","csv","tsv"].includes(ext)
  ) return "xlsx";
  if (mime.startsWith("text/") || TEXT_EXT.has(ext)) return "text";
  return "other";
}

export function niceSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncate(t: string, max = MAX_TEXT_CHARS): string {
  if (t.length <= max) return t;
  return t.slice(0, max) + `\n\n… [truncated ${t.length - max} chars]`;
}

async function readAsText(file: File): Promise<string> {
  return await file.text();
}

async function readAsDataURL(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function extractPdf(file: File): Promise<string> {
  const pdfjs: any = await import("pdfjs-dist");
  // Configure the worker via CDN — Vite-friendly and avoids bundler config.
  try {
    const workerUrl = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  } catch {}
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf, disableWorker: false }).promise;
  const pages: string[] = [];
  const maxPages = Math.min(doc.numPages, 100);
  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map((it: any) => ("str" in it ? it.str : "")).filter(Boolean);
    pages.push(`--- Page ${i} ---\n${strings.join(" ")}`);
  }
  return pages.join("\n\n");
}

async function extractDocx(file: File): Promise<string> {
  // @ts-expect-error — browser entry has no bundled types
  const mammoth: any = await import("mammoth/mammoth.browser.js");
  const buf = await file.arrayBuffer();
  const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
  return value ?? "";
}

async function extractSpreadsheet(file: File): Promise<string> {
  const XLSX: any = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheets: string[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const csv = XLSX.utils.sheet_to_csv(sheet);
    if (csv.trim()) sheets.push(`### Sheet: ${name}\n${csv}`);
  }
  return sheets.join("\n\n");
}

async function extractImageOnServer(file: File): Promise<string> {
  const dataUrl = await readAsDataURL(file);
  const res = await authedFetch("/api/file-extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, mime: file.type || "image/png", dataUrl }),
  });
  if (!res.ok) throw new Error(`Vision extract failed (${res.status})`);
  const j = await res.json();
  return (j?.text as string) ?? "";
}

export async function extractAttachment(file: File): Promise<{ text: string; preview?: string; kind: AttachmentKind }> {
  const kind = classify(file);
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`File exceeds ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)}MB limit`);
  }
  if (kind === "image") {
    const preview = await readAsDataURL(file);
    let text = "";
    try { text = await extractImageOnServer(file); } catch (e: any) { text = ""; }
    return { text: truncate(text), preview, kind };
  }
  if (kind === "pdf") return { text: truncate(await extractPdf(file)), kind };
  if (kind === "docx") return { text: truncate(await extractDocx(file)), kind };
  if (kind === "xlsx") return { text: truncate(await extractSpreadsheet(file)), kind };
  if (kind === "text") return { text: truncate(await readAsText(file)), kind };
  // Try text as a fallback for unknown types
  try {
    const t = await readAsText(file);
    if (t && /[\x20-\x7E]/.test(t)) return { text: truncate(t), kind: "other" };
  } catch {}
  throw new Error("Unsupported file type");
}

// Build a compact context block from attachments for injection into the chat.
export function attachmentsToContext(atts: Attachment[]): string {
  const ready = atts.filter((a) => a.status === "ready" && (a.text?.trim() || a.preview));
  if (!ready.length) return "";
  const parts: string[] = ["# Attached files (verbatim contents)"];
  for (const a of ready) {
    parts.push("");
    parts.push(`## ${a.name} · ${a.kind.toUpperCase()} · ${niceSize(a.size)}`);
    if (a.text?.trim()) parts.push(a.text.trim());
    else if (a.kind === "image") parts.push("(image attached — described above)");
  }
  return parts.join("\n");
}
