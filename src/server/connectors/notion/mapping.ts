import { createHash } from "node:crypto";
import type { ContentItem } from "@/server/fns/content";

export type CalendarRecord = {
  title: string;
  body: string;
  channel: string | null;
  status: string;
  kind: string;
  scheduledAt: string | null;
  mediaUrl: string | null;
  melloxId: string | null;
  workspaceId: string | null;
  malformedDate?: boolean;
};
const text = (value: unknown) =>
  Array.isArray(value)
    ? value.map((part: any) => part?.plain_text ?? part?.text?.content ?? "").join("")
    : "";
const prop = (properties: Record<string, any>, name: string) => properties[name] ?? {};
const readText = (p: any) => text(p.title ?? p.rich_text);
const readSelect = (p: any) => p.select?.name ?? p.status?.name ?? null;
const safeDate = (value: unknown) =>
  typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
export function fromNotion(page: Record<string, any>, bodyBlocks?: string): CalendarRecord {
  const p = page.properties ?? {};
  return {
    title:
      readText(prop(p, "Name")) ||
      readText(Object.values(p).find((v: any) => v?.type === "title")) ||
      "",
    body: bodyBlocks ?? readText(prop(p, "Content")),
    channel: readSelect(prop(p, "Platform")),
    status: readSelect(prop(p, "Status")) ?? "draft",
    kind: readSelect(prop(p, "Content Type")) ?? "post",
    scheduledAt: safeDate(prop(p, "Publish Date").date?.start),
    ...(prop(p, "Publish Date").date?.start != null &&
    safeDate(prop(p, "Publish Date").date.start) === null
      ? { malformedDate: true }
      : {}),
    mediaUrl: prop(p, "Asset URL").url ?? null,
    melloxId: readText(prop(p, "Mellox ID")) || null,
    workspaceId: readText(prop(p, "Mellox Workspace ID")) || null,
  };
}
export function fromMellox(item: ContentItem): CalendarRecord {
  return {
    title: item.title ?? "",
    body: item.body ?? "",
    channel: item.channel,
    status: item.status,
    kind: item.kind,
    scheduledAt: item.scheduled_at,
    mediaUrl: item.media_url,
    melloxId: item.id,
    workspaceId: item.workspace_id,
  };
}
export function syncHash(value: CalendarRecord) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        title: value.title,
        body: value.body,
        channel: value.channel,
        status: value.status,
        kind: value.kind,
        scheduledAt: value.scheduledAt,
        mediaUrl: value.mediaUrl,
      }),
    )
    .digest("hex");
}
const rich = (value: string) => [{ type: "text", text: { content: value.slice(0, 2000) } }];
export function notionProperties(record: CalendarRecord, available?: Record<string, any>) {
  const has = (name: string, type: string) => !available || available[name]?.type === type;
  const result: Record<string, any> = {};
  if (has("Name", "title")) result.Name = { title: rich(record.title || "Untitled content") };
  if (has("Content", "rich_text")) result.Content = { rich_text: rich(record.body) };
  if (has("Platform", "select") && record.channel)
    result.Platform = { select: { name: record.channel } };
  if (record.status && has("Status", "select")) result.Status = { select: { name: record.status } };
  else if (record.status && has("Status", "status"))
    result.Status = { status: { name: record.status } };
  if (has("Content Type", "select") && record.kind)
    result["Content Type"] = { select: { name: record.kind } };
  if (has("Publish Date", "date"))
    result["Publish Date"] = { date: record.scheduledAt ? { start: record.scheduledAt } : null };
  if (has("Mellox ID", "rich_text") && record.melloxId)
    result["Mellox ID"] = { rich_text: rich(record.melloxId) };
  if (has("Mellox Workspace ID", "rich_text") && record.workspaceId)
    result["Mellox Workspace ID"] = { rich_text: rich(record.workspaceId) };
  if (has("Asset URL", "url")) result["Asset URL"] = { url: record.mediaUrl };
  if (has("Last Synced", "date"))
    result["Last Synced"] = { date: { start: new Date().toISOString() } };
  return result;
}
export function notionBodyBlocks(body: string) {
  const blocks = [];
  for (let i = 0; i < body.length; i += 2000)
    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: rich(body.slice(i, i + 2000)) },
    });
  return blocks;
}
export function decideSync(
  melloxHash: string,
  notionHash: string,
  previousMellox: string | null,
  previousNotion: string | null,
) {
  if (!previousMellox || !previousNotion) return "unknown";
  const m = melloxHash !== previousMellox,
    n = notionHash !== previousNotion;
  return m && n ? "conflict" : m ? "export" : n ? "import" : "skip";
}
